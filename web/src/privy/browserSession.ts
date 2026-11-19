const SIGN_IN_WINDOW_MS = 5 * 60_000;
const LEGACY_LOGOUT_FLAG = 'mia:privy-logout';
const memory = new Map<string, string | null>();
const signInKey = (appId: string) => `mia:privy-sign-in:${appId}`;
const logoutKey = (appId: string) => `mia:privy-logout:${appId}`;

function read(key: string) {
  if (memory.has(key)) return memory.get(key);
  try { return sessionStorage.getItem(key); }
  catch { return null; }
}

function write(key: string, value?: string) {
  try {
    if (value === undefined) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
    memory.delete(key);
  } catch { memory.set(key, value ?? null); }
}

export function privyLogoutPending(appId: string) {
  return read(logoutKey(appId)) === '1' || read(LEGACY_LOGOUT_FLAG) === '1';
}

/** Only an explicit sign-in can authorize exchanging the SDK token after an OAuth redirect. */
export function requestPrivySignIn(appId: string) {
  if (privyLogoutPending(appId)) return false;
  write(signInKey(appId), String(Date.now() + SIGN_IN_WINDOW_MS));
  return true;
}

/** SDK state changes and a remount can see the same intent. Only one may use it. */
export function takePrivySignIn(appId: string) {
  if (privyLogoutPending(appId)) return false;
  const key = signInKey(appId);
  const value = read(key);
  if (value == null) return false;
  write(key);
  const deadline = Number(value);
  const now = Date.now();
  return Number.isFinite(deadline) && deadline > now && deadline <= now + SIGN_IN_WINDOW_MS;
}

export function requirePrivyLogout(appId: string) {
  write(signInKey(appId));
  write(logoutKey(appId), '1');
}

export function completePrivyLogout(appId: string) {
  write(logoutKey(appId));
  write(LEGACY_LOGOUT_FLAG);
}
