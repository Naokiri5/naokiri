import { basename, dirname, join, resolve } from 'node:path';
import { closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, type Stats } from 'node:fs';

const owner = process.geteuid?.();
// A user namespace can map the system directory owner to a different visible UID.
const systemOwner = owner === undefined ? undefined : lstatSync(resolve('/')).uid;
const noFollow = (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

function unsafe(path: string, problem: string): Error {
  return new Error(`Unsafe storage path ${basename(path) || path}: ${problem}. Verify storage ownership and permissions before restarting.`);
}

function validateDirectory(path: string, stat: Stats, applicationOwned: boolean): void {
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw unsafe(path, 'expected a real directory');
  if (owner === undefined) return;
  if (stat.uid !== owner && (applicationOwned || (stat.uid !== 0 && stat.uid !== systemOwner))) throw unsafe(path, 'directory owner is untrusted');
  // Root-owned sticky system directories such as /tmp protect each child from rename by other users.
  const stickyAncestor = !applicationOwned && (stat.mode & 0o1000) !== 0;
  if ((stat.mode & 0o022) !== 0 && !stickyAncestor) throw unsafe(path, 'directory is writable by another user');
}

/** Prepare an app-owned directory without changing an existing data volume's mode. */
export function ensureStorageDirectory(path: string): string {
  let existing = resolve(path);
  const missing: string[] = [];
  let stat = lstatSync(existing, { throwIfNoEntry: false });
  while (!stat) {
    missing.push(basename(existing));
    existing = dirname(existing);
    stat = lstatSync(existing, { throwIfNoEntry: false });
  }
  validateDirectory(existing, stat, missing.length === 0);
  // Resolve system aliases such as macOS /var before checking and using the actual directory tree.
  let directory = realpathSync(existing);
  for (let current = directory; current !== dirname(current); current = dirname(current)) {
    validateDirectory(current, lstatSync(current), current === directory && missing.length === 0);
  }
  for (const part of missing.reverse()) {
    directory = join(directory, part);
    try { mkdirSync(directory, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    validateDirectory(directory, lstatSync(directory), true);
  }
  return directory;
}

export class LinkedStorageFileError extends Error {
  constructor(file: string) { super(`Unsafe storage file ${basename(file)}: expected a single link.`); }
}

function validateFile(file: string, stat: Stats, legacyRead = false): void {
  if (!stat.isFile() || stat.isSymbolicLink()) throw unsafe(file, 'expected a regular file without symbolic links');
  if (stat.nlink !== 1) throw new LinkedStorageFileError(file);
  if (owner === undefined) return;
  if (stat.uid !== owner) throw unsafe(file, 'file is owned by a different user');
  // A former SQLite default may expose read bits. Always reject public write, execute or special bits.
  if ((stat.mode & (legacyRead ? 0o7133 : 0o7177)) !== 0) throw unsafe(file, 'expected owner-only permissions (0600)');
}

function openVerifiedRead(file: string, before: Stats, legacyRead = false): number {
  const handle = openSync(file, constants.O_RDONLY | noFollow);
  try {
    const current = fstatSync(handle);
    validateFile(file, current, legacyRead);
    if (current.dev !== before.dev || current.ino !== before.ino) throw unsafe(file, 'file changed during validation');
    return handle;
  } catch (error) {
    closeSync(handle);
    throw error;
  }
}

/** Check without opening the inode. SQLite needs this after it has acquired its own file locks. */
export function privateStorageFileExists(file: string): boolean {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return false;
  validateFile(file, stat);
  return true;
}

/** Tighten read-only legacy permissions on a verified inode before SQLite opens it. */
export function prepareSqliteFile(file: string): boolean {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return false;
  validateFile(file, stat, true);
  if (owner === undefined || (stat.mode & 0o044) === 0) return true;
  let handle: number;
  try { handle = openVerifiedRead(file, stat, true); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  try { fchmodSync(handle, stat.mode & 0o600); }
  finally { closeSync(handle); }
  return true;
}

export function createPrivateSqliteFile(file: string): void {
  try { closeSync(openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  if (!privateStorageFileExists(file)) throw unsafe(file, 'database disappeared before opening');
}

/** Evidence keys are validated through the same descriptor used to read the bytes. */
export function readPrivateStorageFile(file: string): string {
  const before = lstatSync(file);
  validateFile(file, before);
  const handle = openVerifiedRead(file, before);
  try { return readFileSync(handle, 'utf8'); }
  finally { closeSync(handle); }
}
