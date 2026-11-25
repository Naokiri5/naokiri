/** Process-local lifecycle latch, not an execution mode or durable session authority.
 * Only the composition root begins shutdown. This process can never reopen the latch;
 * a successor still needs its own canonical lease and authorized session.
 */
let draining = false;
export function beginShutdown(): boolean {
  if (draining) return false;
  draining = true;
  return true;
}
export const isShuttingDown = () => draining;
