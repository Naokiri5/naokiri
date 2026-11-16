import { all, run, J, P } from '../db/db.js';
import { uid } from '../core/util.js';
export type JournalKind = 'DECISION' | 'ORDER' | 'FILL' | 'EXIT' | 'AUTOPSY' | 'INTERVENTION' | 'RISK' | 'SYSTEM';
export function journal(kind: JournalKind, summary: string, ref?: string, detail?: unknown) {
  run('INSERT INTO journal(id,ts,kind,ref,summary,detail) VALUES (?,?,?,?,?,?)', uid('jr'), Date.now(), kind, ref ?? null, summary.slice(0, 500), detail === undefined ? null : J(detail));
}
export const listJournal = (limit = 300, kind?: string) =>
  (kind ? all<any>('SELECT * FROM journal WHERE kind=? ORDER BY ts DESC LIMIT ?', kind, limit) : all<any>('SELECT * FROM journal ORDER BY ts DESC LIMIT ?', limit)).map((r) => ({ ...r, detail: P(r.detail) }));
