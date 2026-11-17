/**
 * Named checkpoints inside the paper OMS for crash-injection tests (server/test/crash). A no-op unless a test child
 * installs a hook with setCrashHook: nothing in the application calls it, so no env var, route or operator can arm it.
 */
export type CrashPoint =
  | 'entry.preTx' | 'entry.order' | 'entry.fill' | 'entry.position' | 'entry.stop' | 'entry.buy' | 'entry.precommit' | 'entry.committed'
  | 'exit.preTx' | 'exit.order' | 'exit.fill' | 'exit.sell' | 'exit.position' | 'exit.stop' | 'exit.precommit' | 'exit.committed'
  | 'monitor.preTx' | 'monitor.state' | 'monitor.stop' | 'monitor.precommit' | 'monitor.committed';

let hook: ((p: CrashPoint) => void) | null = null;
export function setCrashHook(h: ((p: CrashPoint) => void) | null) { hook = h; }
export function crashpoint(p: CrashPoint) { hook?.(p); }
