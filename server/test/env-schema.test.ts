import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MIA_ENV_VARS, unknownMiaEnv } from '../src/config.js';

const root = resolve(__dirname, '../..');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}
/** Every way the server reads an environment variable: env.X, env['X'], process.env.X and the config intEnv('X') helper. */
const READ = /(?:\benv\.|\benv\[['"]|process\.env\.|process\.env\[['"]|intEnv\(['"]|envMs\(['"])(MIA_[A-Z0-9_]+)/g;

describe('environment schema (roadmap P0.1)', () => {
  const read = new Set(sources(join(root, 'server/src')).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(READ)].map((m) => m[1])));
  const documented = new Set([...readFileSync(join(root, '.env.example'), 'utf8').matchAll(/^(MIA_[A-Z0-9_]+)=/gm)].map((m) => m[1]));

  it('registers every MIA_* variable the server reads', () => {
    expect([...read].filter((name) => !(MIA_ENV_VARS as readonly string[]).includes(name))).toEqual([]);
    expect(read.size).toBeGreaterThan(20);
  });
  it('documents every registered variable in .env.example and nothing else', () => {
    expect(MIA_ENV_VARS.filter((name) => !documented.has(name))).toEqual([]);
    expect([...documented].filter((name) => !(MIA_ENV_VARS as readonly string[]).includes(name))).toEqual([]);
  });
  it('reports unknown MIA_* names (typos) without their values', () => {
    expect(unknownMiaEnv({ MIA_BACKUP_KEYY: 'secret', MIA_BACKUP_KEY: 'x', PATH: '/bin', OTHER_MIA_X: '1' })).toEqual(['MIA_BACKUP_KEYY']);
    expect(unknownMiaEnv({})).toEqual([]);
  });
});
