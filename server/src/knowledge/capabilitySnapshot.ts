/** The capability bridge samples on the existing scheduler's background pass. */
export const CAPABILITY_REFRESH_INTERVAL_MS = 60_000;
const CAPABILITY_SNAPSHOT_MAX_AGE_MS = 3 * CAPABILITY_REFRESH_INTERVAL_MS;

export function capabilitySnapshotView<T extends { capturedAt: number }>(snapshot: T | null, at: number) {
  const lastCapturedAt = snapshot?.capturedAt ?? null;
  const fresh = lastCapturedAt !== null && lastCapturedAt <= at && at - lastCapturedAt <= CAPABILITY_SNAPSHOT_MAX_AGE_MS;
  return {
    latest: fresh ? snapshot : null,
    lastCapturedAt,
    status: !snapshot ? 'NOT_YET_REFRESHED' as const : fresh ? 'REFRESHED' as const : 'STALE' as const,
  };
}
