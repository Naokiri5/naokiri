import { inflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Document text extraction (Part 2, Layer 1). Documents are UNTRUSTED: nothing in them is executed, scripts/styles are
 * dropped, archives are size- and count-limited (zip-bomb defence) and PDFs are parsed with eval disabled.
 * Output is a list of page-tagged text units in a light markdown form ("# Heading", "$$ formula $$", "| table |").
 */
export const EXTRACTOR_VERSION = 'kb-extract@1.0.0';
export const LIMITS = {
  maxUploadBytes: Number(process.env.MIA_KB_MAX_UPLOAD_MB ?? 60) * 1024 * 1024,
  maxZipEntries: 5_000, maxZipTotalBytes: 300 * 1024 * 1024, maxZipEntryBytes: 80 * 1024 * 1024,
  maxPdfPages: 3_000, maxTextChars: 40_000_000,
};
export type Format = 'pdf' | 'epub' | 'docx' | 'html' | 'md' | 'txt';
export interface DocMeta { title?: string; authors?: string; edition?: string; publisher?: string; published?: string }
export interface TextUnit { page: number | null; text: string }
export interface Extracted { format: Format; meta: DocMeta; units: TextUnit[]; pages: number | null; unreadablePages: number[]; warnings: string[] }
export class ExtractionError extends Error { constructor(msg: string, public code: 'UNSUPPORTED' | 'CORRUPT' | 'EMPTY' | 'TOO_LARGE' | 'ENCRYPTED') { super(msg); } }

/** Detect format from magic bytes first, extension second. Never trusts the extension alone. */
export function detectFormat(bytes: Buffer, filename: string): Format {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const names = zipEntries(bytes).map((e) => e.name);
    if (names.includes('META-INF/container.xml') || ext === 'epub') return 'epub';
    if (names.includes('word/document.xml')) return 'docx';
    throw new ExtractionError('ZIP archive is neither EPUB nor DOCX', 'UNSUPPORTED');
  }
  if (ext === 'pdf' || ext === 'epub' || ext === 'docx') throw new ExtractionError(`file content does not match .${ext} (bad signature)`, 'CORRUPT');
  if (bytes.includes(0)) throw new ExtractionError('binary file of unsupported type', 'UNSUPPORTED');
  const head = bytes.subarray(0, 2048).toString('utf8').toLowerCase();
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml' || /<!doctype html|<html[\s>]/.test(head)) return 'html';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'txt' || ext === 'text' || ext === '') return 'txt';
  throw new ExtractionError(`unsupported file type .${ext}`, 'UNSUPPORTED');
}

// ── ZIP (EPUB/DOCX) ──────────────────────────────────────────────────────────
interface ZipEntry { name: string; method: number; compSize: number; size: number; offset: number }
function zipEntries(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ExtractionError('ZIP central directory not found (truncated or corrupt archive)', 'CORRUPT');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  if (count > LIMITS.maxZipEntries) throw new ExtractionError(`archive has ${count} entries (limit ${LIMITS.maxZipEntries})`, 'TOO_LARGE');
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ExtractionError('corrupt ZIP central directory', 'CORRUPT');
    const method = buf.readUInt16LE(p + 10), compSize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), offset = buf.readUInt32LE(p + 42);
    out.push({ name: buf.subarray(p + 46, p + 46 + nl).toString('utf8'), method, compSize, size, offset });
    p += 46 + nl + xl + cl;
  }
  const total = out.reduce((s, e) => s + e.size, 0);
  if (total > LIMITS.maxZipTotalBytes) throw new ExtractionError('archive expands beyond the size limit', 'TOO_LARGE');
  return out;
}
function zipRead(buf: Buffer, e: ZipEntry): Buffer {
  if (e.size > LIMITS.maxZipEntryBytes) throw new ExtractionError(`archive entry ${e.name} too large`, 'TOO_LARGE');
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) throw new ExtractionError(`corrupt ZIP entry ${e.name}`, 'CORRUPT');
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const data = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) {
    try { return inflateRawSync(data, { maxOutputLength: Math.max(1, e.size) + 1024 }); }
    catch { throw new ExtractionError(`cannot decompress ${e.name} (corrupt or size mismatch)`, 'CORRUPT'); }
  }
  throw new ExtractionError(`unsupported ZIP compression method ${e.method}`, 'UNSUPPORTED');
}
function zipText(buf: Buffer, entries: ZipEntry[], name: string): string | null {
  const e = entries.find((x) => x.name === name); return e ? zipRead(buf, e).toString('utf8') : null;
}

// ── markup helpers ───────────────────────────────────────────────────────────
/**
 * Linear-time element replacement for UNTRUSTED markup. Lazy regexes like /<script[\s\S]*?<\/script>/ rescan the rest of
 * the input for every unclosed opener (quadratic: a crafted file can stall the event loop). Here each opener's closing
 * tag is found with one indexOf, and an unclosed element ends the scan (its remainder is dropped when `dropUnclosed`).
 */
export function replaceElements(s: string, tags: string[], fn: (inner: string, tag: string, open: string) => string, dropUnclosed = false): string {
  // ASCII-only folding keeps offsets aligned with `s` (Unicode lowercasing can change string length).
  const lower = s.replace(/[A-Z]+/g, (m) => m.toLowerCase()); const open = new RegExp(`<(${tags.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=[\\s>/])[^<>]{0,2000}>`, 'gi');
  let out = ''; let i = 0;
  for (;;) {
    open.lastIndex = i; const m = open.exec(s); if (!m) break;
    const tag = m[1].toLowerCase(); const close = `</${tag}>`; const end = lower.indexOf(close, m.index + m[0].length);
    if (end < 0) return out + s.slice(i, m.index) + (dropUnclosed ? ' ' : s.slice(m.index));
    out += s.slice(i, m.index) + fn(s.slice(m.index + m[0].length, end), tag, m[0]); i = end + close.length;
  }
  return out + s.slice(i);
}
/** Linear-time removal of <!-- comments -->; an unclosed comment drops the remainder. */
function stripComments(s: string) {
  let out = ''; let i = 0;
  for (;;) { const a = s.indexOf('<!--', i); if (a < 0) return out + s.slice(i); const b = s.indexOf('-->', a + 4); if (b < 0) return out + s.slice(i, a); out += s.slice(i, a) + ' '; i = b + 3; }
}
const flat = (t: string) => t.replace(/<[^<>]{0,2000}>/g, ' ').replace(/\s+/g, ' ').trim();
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', minus: '−', times: '×', le: '≤', ge: '≥', sigma: 'σ', mu: 'μ', alpha: 'α', beta: 'β' };
export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const xmlTags = (xml: string, tag: string) => { const out: string[] = []; replaceElements(xml, [tag], (t) => { const v = decodeEntities(t.replace(/<[^<>]{0,2000}>/g, '')).trim(); if (v) out.push(v); return ''; }); return out; };
const xmlTag = (xml: string, tag: string) => xmlTags(xml, tag)[0] || undefined;

/** HTML/XHTML → structured plain text. Scripts, styles, forms and comments are discarded, never interpreted. */
export function htmlToText(html: string): { title?: string; text: string } {
  const title = xmlTag(html, 'title');
  let s = replaceElements(stripComments(html), ['script', 'style', 'noscript', 'svg', 'form', 'iframe', 'object', 'head'], () => ' ', true);
  s = replaceElements(s, ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'], (t, tag) => `\n${'#'.repeat(Number(tag[1]))} ${flat(t)}\n`);
  s = replaceElements(s, ['math'], (t) => `\n$$ ${flat(t)} $$\n`);
  s = replaceElements(s, ['tr'], (r) => { const cells: string[] = []; replaceElements(r, ['th', 'td'], (c) => { cells.push(flat(c)); return ''; }); return `\n| ${cells.join(' | ')} |`; });
  s = s.replace(/<(br|hr)\s*\/?>/gi, '\n').replace(/<\/(p|div|li|section|article|blockquote|table|pre|dd|dt)>/gi, '\n\n').replace(/<li[^>]*>/gi, '\n- ');
  s = decodeEntities(s.replace(/<[^<>]{1,2000}>/g, ' ')).replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  return { title, text: s.trim() };
}

/** Heuristic metadata from the opening text (used only when the container carries none). Marked as heuristic upstream. */
/** Text heuristics fill only the fields the container metadata (`known`) leaves undefined — they never override it. */
export function sniffMeta(text: string, known: DocMeta = {}): DocMeta {
  const head = text.slice(0, 6000);
  const ed = head.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d{1,2}(?:st|nd|rd|th))\s+edition\b/i);
  const pub = head.match(/published by\s+([^\n.]{3,80})/i);
  const year = head.match(/(?:copyright|©|\(c\))\s*(?:©\s*)?((?:19|20)\d{2})/i);
  const sniffed: DocMeta = { edition: ed ? `${ed[1]} edition` : undefined, publisher: pub?.[1].trim(), published: year?.[1] };
  const out: DocMeta = {};
  for (const k of ['title', 'authors', 'edition', 'publisher', 'published'] as const) { const v = known[k] ?? sniffed[k]; if (v !== undefined) out[k] = v; }
  return out;
}

// ── formats ──────────────────────────────────────────────────────────────────
function plain(format: 'txt' | 'md', bytes: Buffer): Extracted {
  const text = bytes.toString('utf8').replace(/\r\n?/g, '\n');
  if (text.includes('�') && (text.match(/�/g)!.length > text.length * 0.01)) throw new ExtractionError('file is not valid UTF-8 text', 'CORRUPT');
  const firstHeading = text.match(/^#\s+(.+)$/m)?.[1].trim();
  return { format, meta: sniffMeta(text, { title: format === 'md' ? firstHeading : undefined }), units: [{ page: null, text }], pages: null, unreadablePages: [], warnings: [] };
}
function html(bytes: Buffer): Extracted {
  const { title, text } = htmlToText(bytes.toString('utf8'));
  return { format: 'html', meta: sniffMeta(text, { title }), units: [{ page: null, text }], pages: null, unreadablePages: [], warnings: [] };
}
function docx(bytes: Buffer): Extracted {
  const entries = zipEntries(bytes); const xml = zipText(bytes, entries, 'word/document.xml');
  if (!xml) throw new ExtractionError('DOCX has no word/document.xml', 'CORRUPT');
  const core = zipText(bytes, entries, 'docProps/core.xml') ?? '';
  const out: string[] = [];
  // Tables become one paragraph of "| a | b |" rows; all scans are linear (see replaceElements).
  const texts = (x: string) => { const t: string[] = []; replaceElements(x, ['w:t'], (v) => { t.push(v); return ''; }); return t.join(''); };
  const body = replaceElements(xml, ['w:tbl'], (tbl) => { const rows: string[] = []; replaceElements(tbl, ['w:tr'], (r) => { const cells: string[] = []; replaceElements(r, ['w:tc'], (c) => { cells.push(texts(c).trim()); return ''; }); rows.push(`| ${cells.join(' | ')} |`); return ''; }); return `<w:p><w:r><w:t>${rows.join('\u2028')}</w:t></w:r></w:p>`; });
  const paras: string[] = []; replaceElements(body, ['w:p'], (inner, _t, open) => { paras.push(open + inner); return ''; });
  for (const para of paras) {
    const style = para.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? '';
    const text = decodeEntities([...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map((m) => (m[1] !== undefined ? m[1] : m[0] === '<w:tab/>' ? '\t' : '\n')).join('')).replace(/\u2028/g, '\n');
    const level = style.match(/^(?:Heading|heading)(\d)$/)?.[1] ?? (style === 'Title' ? '1' : null);
    if (!text.trim()) continue;
    out.push(level ? `${'#'.repeat(Number(level))} ${text.trim()}` : text);
    if (para.includes('<m:oMath')) out.push(`$$ ${xmlTags(para, 'm:t').join(' ')} $$`);
  }
  const text = out.join('\n\n');
  return { format: 'docx', meta: sniffMeta(text, { title: xmlTag(core, 'dc:title'), authors: xmlTag(core, 'dc:creator'), published: xmlTag(core, 'dcterms:created')?.slice(0, 10) }),
    units: [{ page: null, text }], pages: null, unreadablePages: [], warnings: ['DOCX has no fixed pages; references use section headings'] };
}
function epub(bytes: Buffer): Extracted {
  const entries = zipEntries(bytes);
  const container = zipText(bytes, entries, 'META-INF/container.xml'); const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new ExtractionError('EPUB container.xml has no package path', 'CORRUPT');
  const opf = zipText(bytes, entries, opfPath); if (!opf) throw new ExtractionError('EPUB package document missing', 'CORRUPT');
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = new Map([...opf.matchAll(/<item\b[^>]*>/g)].map((m) => [m[0].match(/id="([^"]+)"/)?.[1], m[0].match(/href="([^"]+)"/)?.[1]]));
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => manifest.get(m[1])).filter(Boolean) as string[];
  if (!spine.length) throw new ExtractionError('EPUB spine is empty', 'EMPTY');
  const warnings: string[] = []; const units: TextUnit[] = [];
  spine.forEach((href) => {
    const name = decodeURIComponent(base + href.split('#')[0]); const e = entries.find((x) => x.name === name);
    if (!e) { warnings.push(`spine item missing: ${href}`); return; }
    const t = htmlToText(zipRead(bytes, e).toString('utf8')).text; if (t.trim()) units.push({ page: null, text: t });
  });
  if (opf.includes('encryption') || entries.some((x) => x.name === 'META-INF/encryption.xml')) {
    // Encrypted resources decode to binary noise, so judge by readable text, not by whether bytes were present.
    if (!units.some((u) => (u.text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 20)) throw new ExtractionError('EPUB content is DRM-encrypted; MIA cannot and will not bypass DRM', 'ENCRYPTED');
    warnings.push('EPUB declares encryption for some resources; only unencrypted content was read');
  }
  return { format: 'epub', meta: sniffMeta(units.map((u) => u.text).join('\n').slice(0, 8000), { title: xmlTag(opf, 'dc:title'), authors: xmlTags(opf, 'dc:creator').join(', ') || undefined, publisher: xmlTag(opf, 'dc:publisher'), published: xmlTag(opf, 'dc:date')?.slice(0, 10) }),
    units, pages: null, unreadablePages: [], warnings: [...warnings, 'EPUB is reflowable; references use chapter headings, not printed pages'] };
}

let pdfjsP: Promise<any> | null = null;
const req = createRequire(import.meta.url);
async function pdf(bytes: Buffer, fromPage = 1, toPage = Infinity, onPage?: (page: number, total: number) => void): Promise<Extracted> {
  pdfjsP ??= import('pdfjs-dist/legacy/build/pdf.mjs' as string);
  const pdfjs = await pdfjsP;
  const fonts = join(dirname(req.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';
  let doc: any;
  try { doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, standardFontDataUrl: fonts, verbosity: 0 }).promise; }
  catch (e: any) {
    if (e?.name === 'PasswordException') throw new ExtractionError('PDF is password-protected', 'ENCRYPTED');
    throw new ExtractionError(`PDF could not be parsed: ${String(e?.message ?? e).slice(0, 160)}`, 'CORRUPT');
  }
  try {
    if (doc.numPages > LIMITS.maxPdfPages) throw new ExtractionError(`PDF has ${doc.numPages} pages (limit ${LIMITS.maxPdfPages})`, 'TOO_LARGE');
    const info = (await doc.getMetadata().catch(() => null))?.info ?? {};
    const units: TextUnit[] = []; const unreadable: number[] = [];
    for (let n = Math.max(1, fromPage); n <= Math.min(doc.numPages, toPage); n++) {
      try {
        const page = await doc.getPage(n); const tc = await page.getTextContent();
        let text = ''; let lastY: number | null = null;
        for (const it of tc.items as any[]) {
          if (typeof it.str !== 'string') continue;
          const y = it.transform?.[5];
          if (lastY != null && y != null && Math.abs(y - lastY) > 2 && !text.endsWith('\n')) text += '\n';
          text += it.str + (it.hasEOL ? '\n' : ''); lastY = y;
        }
        if (text.replace(/\s/g, '').length < 3) unreadable.push(n); else units.push({ page: n, text });
        page.cleanup?.();
      } catch { unreadable.push(n); }
      onPage?.(n, doc.numPages);
    }
    const pdfDate = typeof info.CreationDate === 'string' ? info.CreationDate.match(/^D:(\d{4})(\d{2})?(\d{2})?/) : null;
    const warnings = unreadable.length ? [`${unreadable.length} page(s) had no extractable text (scanned images need OCR, which is not configured)`] : [];
    return { format: 'pdf', meta: sniffMeta(units.slice(0, 6).map((u) => u.text).join('\n'), { title: info.Title || undefined, authors: info.Author || undefined, published: pdfDate ? [pdfDate[1], pdfDate[2], pdfDate[3]].filter(Boolean).join('-') : undefined }),
      units, pages: doc.numPages, unreadablePages: unreadable, warnings };
  } finally { await doc.destroy?.(); }
}

/** Extract a document. Throws ExtractionError for anything that must be reported as failed — never returns fake text. */
export async function extract(bytes: Buffer, filename: string, opts: { fromPage?: number; toPage?: number; allowEmpty?: boolean; onPage?: (page: number, total: number) => void } = {}): Promise<Extracted> {
  if (!bytes.length) throw new ExtractionError('file is empty', 'EMPTY');
  if (bytes.length > LIMITS.maxUploadBytes) throw new ExtractionError(`file exceeds ${Math.round(LIMITS.maxUploadBytes / 1048576)} MB`, 'TOO_LARGE');
  const format = detectFormat(bytes, filename);
  const r = format === 'pdf' ? await pdf(bytes, opts.fromPage, opts.toPage, opts.onPage) : format === 'epub' ? epub(bytes) : format === 'docx' ? docx(bytes) : format === 'html' ? html(bytes) : plain(format, bytes);
  const chars = r.units.reduce((s, u) => s + u.text.length, 0);
  if (chars > LIMITS.maxTextChars) throw new ExtractionError('extracted text exceeds the size limit', 'TOO_LARGE');
  // allowEmpty: a PDF page batch may legitimately be empty; the caller checks the whole document afterwards.
  if (!opts.allowEmpty && !r.units.some((u) => u.text.replace(/\s/g, '').length >= 20)) throw new ExtractionError(format === 'pdf' && r.pages ? `no extractable text in ${r.pages} page(s) — likely a scanned PDF; OCR is not configured` : 'document contains no readable text', 'EMPTY');
  return r;
}
