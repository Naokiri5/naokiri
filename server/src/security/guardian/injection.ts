/**
 * Guardian Shield: prompt-injection detection for text MIA's AI reads (GUARD-041…048).
 *
 * Text from the owner's chat with Trader Joe, news headlines and uploaded knowledge documents can carry instructions
 * aimed at the AI ("ignore previous instructions", fake "system:" turns, requests to withdraw funds or disable stops).
 * This module only DETECTS and RECORDS: the text is still handled as data everywhere, nothing is blocked, and Trader
 * Joe has no privileged tools in any case. A record becomes a Guardian PROMPT_INJECTION event (P1, "quarantine the
 * input"), which never triggers the automatic pause, so planted headlines cannot be used to stop trading.
 *
 * The audit row never contains the text: only a short hash, its length and the signal names, because a pasted message
 * can contain a secret. Recording is de-duplicated and capped per hour so a stream of hostile text cannot grow the
 * append-only audit log without bound. Signals are heuristics, not verdicts.
 */
import { createHash } from 'node:crypto';
import { audit } from '../../core/audit.js';

export type InjectionSource = 'joe' | 'news' | 'knowledge';
export type InjectionSignal =
  | 'INSTRUCTION_OVERRIDE' | 'ROLE_SPOOF' | 'PERSONA_SWITCH' | 'PRIVILEGED_ACTION_REQUEST' | 'SECRET_REQUEST' | 'HIDDEN_TEXT' | 'ENCODED_PAYLOAD';

/** Only this much of a text is scanned; longer texts are bounded work. */
export const MAX_SCAN_CHARS = 20_000;
/** At most this many injection records per hour across all sources. */
export const MAX_RECORDS_PER_HOUR = 30;

/** True when the match is preceded closely by a negation ("never share your seed phrase"), i.e. a warning, not a request. */
const negated = (t: string, index: number) => /\b(?:never|not|don'?t|do not|no one should)\b[^.\n]{0,20}$/i.test(t.slice(Math.max(0, index - 30), index));
const test = (re: RegExp, allowNegated = true) => (t: string) => { const m = re.exec(t); return !!m && (allowNegated || !negated(t, m.index)); };

// Each rule asks for request-like wording, so ordinary market text ("whales move coins", "hackers steal private keys",
// "you are now able to buy BTC on PayPal") does not trigger it. A match is a signal for review, never a verdict.
const RULES: Array<[InjectionSignal, (t: string) => boolean]> = [
  ['INSTRUCTION_OVERRIDE', test(/\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|your|system)\b[^.\n]{0,40}\b(?:instructions?|rules?|prompts?|guidelines?)\b/i)],
  ['ROLE_SPOOF', test(/(?:^|\n)\s*(?:system|assistant)\s*:\s*\S|<\|im_start\|>|<\|im_end\|>|\[\/?INST\]|<\/?(?:system|assistant)>/i)],
  ['PERSONA_SWITCH', test(/\byou are now (?:an? |in |my |the )?(?:admin|administrator|developer|system|root|unrestricted|jailbroken|DAN)\b|\bfrom now on,? you (?:will|must|are|should)\b|\bnew instructions?\s*:|\bact as (?:an? )?(?:admin|administrator|developer|system|root)\b|\bDAN mode\b|\bdeveloper mode\b/i)],
  ['PRIVILEGED_ACTION_REQUEST', (t) =>
    test(/\b(?:withdraw|transfer|send)\b[^.\n]{0,30}\b(?:all|your|the)\b[^.\n]{0,15}\b(?:funds|balance|money|coins|crypto|assets|usdt|usdc)\b[^.\n]{0,40}\bto\b[^.\n]{0,25}\b(?:this|my|the following|address|wallet)\b/i, false)(t)
    || test(/\b(?:disable|turn off|bypass|deactivate|ignore)\b[^.\n]{0,30}\b(?:risk (?:gate|checks?|limits?)|stop[- ]?loss(?:es)?|guardian|2fa|two[- ]factor|step[- ]?up|safety (?:checks?|limits?))\b/i, false)(t)
    || test(/\b(?:enable|switch to|turn on|activate)\b[^.\n]{0,20}\blive (?:trading|mode)\b/i, false)(t)],
  ['SECRET_REQUEST', test(/\b(?:send|share|give|tell|provide|enter|paste|reveal|show|export|print|type)\b[^.\n]{0,30}\b(?:seed phrase|recovery phrase|private keys?|mnemonic|secret key|api secret)\b/i, false)],
  // Zero-width, bidirectional-override and tag characters can hide instructions from a human reader.
  ['HIDDEN_TEXT', test(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/u)],
  ['ENCODED_PAYLOAD', test(/[A-Za-z0-9+/]{200,}={0,2}/)],
];

/** Which injection signals a text shows. Pure and bounded; an empty list means none were found (not "safe"). */
export function detectInjection(text: unknown): InjectionSignal[] {
  if (typeof text !== 'string' || !text) return [];
  const t = text.slice(0, MAX_SCAN_CHARS);
  return RULES.filter(([, hit]) => hit(t)).map(([name]) => name);
}

const seen = new Map<string, number>(); // dedupe key -> last recorded (ms)
let recent: number[] = [];
const DEDUPE_MS = 24 * 3600_000;

/**
 * Scan untrusted text and, if it shows signals, record one audit event `<source>.injection` (which Guardian reads).
 * `ref` identifies the item (news id, document id); the same source + ref + content is recorded once per 24 hours.
 * Returns the signals found, recorded or not. Never throws: a detector fault must not affect the caller.
 */
export function screenUntrusted(source: InjectionSource, text: unknown, ref = '', nowMs = Date.now()): InjectionSignal[] {
  try {
    const signals = detectInjection(text);
    if (!signals.length) return signals;
    const hash = createHash('sha256').update(String(text).slice(0, MAX_SCAN_CHARS)).digest('hex').slice(0, 16);
    const key = `${source}|${ref}|${hash}`;
    const last = seen.get(key);
    if (last !== undefined && nowMs - last < DEDUPE_MS) return signals;
    recent = recent.filter((t) => nowMs - t < 3600_000);
    if (recent.length >= MAX_RECORDS_PER_HOUR) return signals;
    recent.push(nowMs);
    if (seen.size >= 5_000) seen.delete(seen.keys().next().value!);
    seen.set(key, nowMs);
    audit('guardian', `${source}.injection`, { signals, textHash: hash, length: String(text).length, ref: ref.slice(0, 64) });
    return signals;
  } catch { return []; }
}

/** Tests only. */
export function _resetInjectionScreen() { seen.clear(); recent = []; }
