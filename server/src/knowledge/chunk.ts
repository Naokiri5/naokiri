import { createHash } from 'node:crypto';
import type { TextUnit } from './extract.js';

/**
 * Structure-aware chunking (Part 2, Layer 1 steps 5–7). Detects chapters, headings, equations and tables, keeps page
 * ranges, and never lets a chunk cross a chapter boundary. Deterministic: the same text always yields the same chunks.
 */
export type ChunkKind = 'text' | 'equation' | 'table' | 'references';
export interface Chunk { seq: number; chapter: string | null; heading: string | null; pageStart: number | null; pageEnd: number | null; kind: ChunkKind; text: string; hash: string; tokens: number }
export const CHUNK = { target: 1_100, max: 1_800, min: 200 };

const CHAPTER_LINE = /^(?:chapter|part)\s+(?:\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten)\b[.:\s-]*.{0,90}$/i;
const EQUATION_LINE = /(?:[=≈≤≥∑∏∫√σμ]|\\frac|\\sum|\bE\[|\bVar\(|\bCov\()/;
export const normalizeText = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
export const hashText = (s: string) => createHash('sha256').update(normalizeText(s)).digest('hex');
export const tokenCount = (s: string) => (s.match(/\S+/g) ?? []).length;

interface Block { kind: ChunkKind | 'heading'; level?: number; text: string; page: number | null }
function blocks(units: TextUnit[]): Block[] {
  const out: Block[] = [];
  for (const u of units) {
    // Isolate heading lines (markdown, "Chapter N", "References") so a heading followed by body text without a blank
    // line still splits into heading + body instead of being swallowed or dropped.
    const paras = u.text.replace(/\r/g, '').replace(/^(#{1,6}\s+.+|(?:references|bibliography|works cited)\s*:?\s*)$/gim, '\n\n$1\n\n')
      .replace(/^(.{0,100})$/gm, (l) => (CHAPTER_LINE.test(l.trim()) ? `\n\n${l}\n\n` : l)).split(/\n{2,}/);
    for (const raw of paras) {
      const p = raw.trim(); if (!p) continue;
      const lines = p.split('\n');
      const md = p.match(/^(#{1,6})\s+(.+)$/);
      if (md && lines.length === 1) { out.push({ kind: 'heading', level: md[1].length, text: md[2].trim(), page: u.page }); continue; }
      if (lines.length === 1 && lines[0].trim().length <= 100 && CHAPTER_LINE.test(lines[0].trim())) { out.push({ kind: 'heading', level: 1, text: lines[0].trim(), page: u.page }); continue; }
      if (/^\$\$[\s\S]*\$\$$/.test(p)) { out.push({ kind: 'equation', text: p.replace(/^\$\$|\$\$$/g, '').trim(), page: u.page }); continue; }
      if (lines.length >= 2 && lines.every((l) => /^\s*\|.*\|\s*$/.test(l))) { out.push({ kind: 'table', text: p, page: u.page }); continue; }
      if (/^(references|bibliography|works cited)\s*:?\s*$/i.test(lines[0].trim())) { out.push({ kind: 'heading', level: 2, text: lines[0].trim(), page: u.page }); if (lines.length > 1) out.push({ kind: 'references', text: lines.slice(1).join('\n'), page: u.page }); continue; }
      // PDF pages arrive as one paragraph per line run: split them into lines but keep short display equations apart.
      if (u.page != null && lines.length > 1) {
        let buf: string[] = [];
        const flush = () => { if (buf.length) { out.push({ kind: 'text', text: buf.join(' ').replace(/-\s+(?=[a-z])/g, ''), page: u.page }); buf = []; } };
        for (const l of lines) {
          const t = l.trim(); if (!t) { flush(); continue; }
          if (CHAPTER_LINE.test(t) && t.length < 100) { flush(); out.push({ kind: 'heading', level: 1, text: t, page: u.page }); continue; }
          if (t.length < 120 && EQUATION_LINE.test(t) && (t.match(/[A-Za-z]{4,}/g)?.length ?? 0) <= 3) { flush(); out.push({ kind: 'equation', text: t, page: u.page }); continue; }
          buf.push(t);
        }
        flush(); continue;
      }
      out.push({ kind: 'text', text: lines.join('\n'), page: u.page });
    }
  }
  // Text after a References/Bibliography heading is a reference list until the next heading.
  let inRefs = false;
  for (const b of out) {
    if (b.kind === 'heading') inRefs = /^(references|bibliography|works cited)\b/i.test(b.text);
    else if (inRefs && b.kind === 'text') b.kind = 'references';
  }
  return out;
}

/** Carried between PDF page batches so resumed ingestion keeps chapter context and sequence numbers. */
export interface ChunkState { seq: number; chapter: string | null; heading: string | null }
export function chunkDocument(units: TextUnit[], start: ChunkState = { seq: 0, chapter: null, heading: null }): { chunks: Chunk[]; state: ChunkState } {
  const out: Chunk[] = []; let chapter: string | null = start.chapter; let heading: string | null = start.heading;
  let cur: { texts: string[]; kind: ChunkKind; pageStart: number | null; pageEnd: number | null } | null = null;
  const emit = () => {
    if (!cur) return; const text = cur.texts.join('\n\n').trim(); const kind = cur.kind; const ps = cur.pageStart, pe = cur.pageEnd; cur = null;
    if (!text) return;
    out.push({ seq: start.seq + out.length, chapter, heading, pageStart: ps, pageEnd: pe, kind, text, hash: hashText(text), tokens: tokenCount(text) });
  };
  for (const b of blocks(units)) {
    if (b.kind === 'heading') {
      emit();
      if ((b.level ?? 2) <= 1) { chapter = b.text.slice(0, 200); heading = null; } else heading = b.text.slice(0, 200);
      continue;
    }
    if (b.kind !== 'text') { emit(); cur = { texts: [b.text], kind: b.kind, pageStart: b.page, pageEnd: b.page }; emit(); continue; }
    // split oversized paragraphs on sentence boundaries
    const pieces = b.text.length <= CHUNK.max ? [b.text] : b.text.match(new RegExp(`[\\s\\S]{1,${CHUNK.target}}(?:[.!?](?=\\s)|$)|[\\s\\S]{1,${CHUNK.max}}`, 'g'))!.map((x) => x.trim()).filter(Boolean);
    for (const piece of pieces) {
      const len = cur ? cur.texts.reduce((s, t) => s + t.length + 2, 0) : 0;
      if (cur && (cur.kind !== 'text' || len + piece.length > CHUNK.target) && len >= CHUNK.min) emit();
      if (!cur) cur = { texts: [], kind: 'text', pageStart: b.page, pageEnd: b.page };
      cur.texts.push(piece); if (b.page != null) { cur.pageStart ??= b.page; cur.pageEnd = b.page; }
    }
  }
  emit();
  return { chunks: out, state: { seq: start.seq + out.length, chapter, heading } };
}
