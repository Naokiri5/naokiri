/** Accept IANA identifiers and UTC. Keep numeric offsets on the legacy calendar path. */
export function timeZoneName(value: string): string | null {
  if (value !== 'UTC' && !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+$/.test(value)) return null;
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/** Fixed numeric fields keep calendar grouping independent of the host locale. */
export function zonedDateFormatter(timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return (ts: number) => formatter.format(ts);
}

export function zonedClock(ts: number, timeZone: string) {
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
  }).formatToParts(ts);
  const fields = Object.fromEntries(local.map(p => [p.type, p.value]));
  return {
    timeZone, local: `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}:${fields.second}`,
    offset: fields.timeZoneName === 'GMT' ? 'GMT+00:00' : fields.timeZoneName,
  };
}
