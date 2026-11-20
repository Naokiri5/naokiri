/**
 * Ends a live-stream (SSE) response without letting a client that stopped reading hold up a graceful shutdown.
 * `end()` waits for buffered output to drain; if the response has not finished within `flushMs`, its socket is
 * destroyed so app.close() is not pushed to the 30-second hard exit (CodeRabbit #45). A client that reads normally
 * still gets a clean end.
 */
export interface EndableResponse {
  end(): unknown;
  destroy(): unknown;
  readonly writableFinished: boolean;
  once(event: 'finish', listener: () => void): unknown;
}
export const SSE_FLUSH_MS = 2_000;
export function endStream(res: EndableResponse, flushMs = SSE_FLUSH_MS) {
  res.end();
  if (res.writableFinished) return;
  const timer = setTimeout(() => { if (!res.writableFinished) res.destroy(); }, flushMs);
  (timer as { unref?: () => void }).unref?.();
  res.once('finish', () => clearTimeout(timer));
}
