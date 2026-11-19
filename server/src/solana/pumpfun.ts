/**
 * Omega PR-07: read-only decoding of Pump.fun launch and graduation events from Solana transaction logs.
 *
 * Source of truth: the official IDL in github.com/pump-fun/pump-public-docs (idl/pump.json, commit 639b87f). Every
 * address below was checked on mainnet on 2026-11-19: both programs are executable; the mint authority appears in real
 * `create_v2` transactions; the withdraw authority was read from the program's Global account
 * (4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf).
 *
 * Pure functions: no network I/O, no signing, no transaction building. Token names and symbols are chosen by whoever
 * launches the token; they are display-cleaned, and metadata URIs are dropped (never fetched).
 */
import { displayText } from '../core/util.js';

export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
/** Signs every `create` / `create_v2`: subscribing to logs that mention it yields launches only (~0.3 per second). */
export const PUMP_MINT_AUTHORITY = 'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM';
/** Global.withdraw_authority, required by `migrate`: subscribing to it yields graduations to PumpSwap. */
export const PUMP_WITHDRAW_AUTHORITY = '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg';

const DISC_CREATE = [27, 114, 169, 77, 222, 235, 99, 118];
const DISC_MIGRATION = [189, 233, 93, 185, 92, 148, 234, 148]; // CompletePumpAmmMigrationEvent
const MAX_STRING_BYTES = 200; // names/symbols/URIs longer than this are not real launches
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export interface PumpLaunch {
  kind: 'LAUNCH'; signature: string; slot: number; mint: string; bondingCurve: string; creator: string;
  name: string; symbol: string; createdAt: number | null; tokenProgram: string;
}
export interface PumpGraduation {
  kind: 'GRADUATION'; signature: string; slot: number; mint: string; pool: string; bondingCurve: string; graduatedAt: number | null;
}

export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out;
}

/** Minimal Borsh reader; every read is bounds-checked and throws on short data. */
class Reader {
  o = 8; // after the 8-byte event discriminator
  constructor(private readonly b: Buffer) {}
  private need(n: number) { if (this.o + n > this.b.length) throw new RangeError('short event'); }
  pubkey() { this.need(32); const k = base58(this.b.subarray(this.o, this.o + 32)); this.o += 32; return k; }
  str() {
    this.need(4); const len = this.b.readUInt32LE(this.o); this.o += 4;
    if (len > MAX_STRING_BYTES) throw new RangeError('string too long');
    this.need(len); const s = this.b.subarray(this.o, this.o + len).toString('utf8'); this.o += len; return s;
  }
  i64() { this.need(8); const v = this.b.readBigInt64LE(this.o); this.o += 8; return v; }
  u64() { this.need(8); const v = this.b.readBigUInt64LE(this.o); this.o += 8; return v; }
  skip(n: number) { this.need(n); this.o += n; }
}

const sameDisc = (b: Buffer, d: number[]) => b.length >= 8 && d.every((x, i) => b[i] === x);
/** Unix seconds to ms, only when plausible (2020..2100); otherwise null rather than a made-up time. */
const toMs = (s: bigint) => (s > 1_577_836_800n && s < 4_102_444_800n ? Number(s) * 1000 : null);

/** CreateEvent (IDL order): name, symbol, uri, mint, bonding_curve, user, creator, timestamp, 4×u64 reserves, token_program, … */
export function decodeCreate(data: Buffer, signature: string, slot: number): PumpLaunch | null {
  if (!sameDisc(data, DISC_CREATE)) return null;
  try {
    const r = new Reader(data);
    const name = r.str(); const symbol = r.str(); r.str(); // uri: dropped, never fetched
    const mint = r.pubkey(); const bondingCurve = r.pubkey(); r.pubkey(); /* user */ const creator = r.pubkey();
    const createdAt = toMs(r.i64());
    r.u64(); r.u64(); r.u64(); r.u64(); // virtual token/sol, real token reserves, total supply
    const tokenProgram = r.pubkey();
    return { kind: 'LAUNCH', signature, slot, mint, bondingCurve, creator, name: displayText(name, '?', 60), symbol: displayText(symbol, '?'), createdAt, tokenProgram };
  } catch { return null; }
}

/** CompletePumpAmmMigrationEvent (IDL order): user, mint, mint_amount, sol_amount, pool_migration_fee, bonding_curve, timestamp, pool, … */
export function decodeMigration(data: Buffer, signature: string, slot: number): PumpGraduation | null {
  if (!sameDisc(data, DISC_MIGRATION)) return null;
  try {
    const r = new Reader(data);
    r.pubkey(); const mint = r.pubkey(); r.u64(); r.u64(); r.u64();
    const bondingCurve = r.pubkey(); const graduatedAt = toMs(r.i64()); const pool = r.pubkey();
    return { kind: 'GRADUATION', signature, slot, mint, pool, bondingCurve, graduatedAt };
  } catch { return null; }
}

// Program ids are base58, so a line a program prints itself ("Program log: …", always prefixed by the runtime) can never
// match these frame lines (review fix: an id like "log:" used to be accepted).
const INVOKE = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[(\d+)\]$/;
const LEAVE = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) (?:success|failed.*)$/;

/**
 * Decode the Pump.fun events of one successful transaction from its log lines. A "Program data:" line counts only while
 * the Pump.fun program itself is the executing program: any program can print bytes that look like a Pump.fun event,
 * so lines emitted by another program (or outside any invocation) are ignored. The invoke stack must stay consistent
 * (depth N follows N-1, each success/failed closes the frame on top); any inconsistency rejects the whole transaction.
 */
export function parsePumpLogs(logs: readonly unknown[], signature: string, slot: number): Array<PumpLaunch | PumpGraduation> {
  const out: Array<PumpLaunch | PumpGraduation> = [];
  const stack: string[] = [];
  for (const line of logs) {
    if (typeof line !== 'string') continue;
    const inv = INVOKE.exec(line);
    if (inv) {
      if (Number(inv[2]) !== stack.length + 1) return []; // a frame line out of order: do not trust this transaction
      stack.push(inv[1]); continue;
    }
    const leave = LEAVE.exec(line);
    if (leave) {
      if (stack.at(-1) !== leave[1]) return [];
      stack.pop(); continue;
    }
    if (!line.startsWith('Program data: ') || stack.at(-1) !== PUMP_PROGRAM) continue;
    const data = Buffer.from(line.slice('Program data: '.length), 'base64');
    const ev = decodeCreate(data, signature, slot) ?? decodeMigration(data, signature, slot);
    if (ev) out.push(ev);
  }
  return out;
}
