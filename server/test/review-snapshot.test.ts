import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/create-review-snapshot.mjs', import.meta.url));

describe('commit-scoped review snapshot', () => {
  let cwd: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const write = (path: string, contents: string | Buffer) => {
    const target = join(cwd, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };
  const commit = (message: string) => {
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', message);
    return git('rev-parse', 'HEAD');
  };
  const generate = (...args: string[]) => execFileSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'mia-review-snapshot-'));
    git('init', '-q');
    git('remote', 'add', 'origin', 'https://example-user@github.com/Example/fixture.git');
  });

  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it('uses Git object bytes and produces stable paths and directly related tests', () => {
    write('server/src/guard.ts', 'export const guard = false;\n');
    write('server/src/removed.ts', 'export const removed = true;\n');
    write('server/test/guard.test.ts', 'import { guard } from "../src/guard.js";\n');
    write('server/test/other.test.ts', 'export const unrelated = true;\n');
    const base = commit('base');
    const committed = 'export const guard = true;\n';
    write('server/src/guard.ts', committed);
    rmSync(join(cwd, 'server/src/removed.ts'));
    const sha = commit('review');
    write('server/src/guard.ts', 'this change is uncommitted\n');
    write('server/src/untracked.ts', 'this file is untracked\n');

    const raw = generate('--commit', sha, '--base', base);
    const manifest = JSON.parse(raw);
    expect(manifest).toMatchObject({
      schemaVersion: 1, repository: 'Example/fixture', commitSha: sha,
      changedFiles: ['server/src/guard.ts', 'server/src/removed.ts'], relevantTests: ['server/test/guard.test.ts'],
    });
    expect(new Date(manifest.generatedAt).toISOString()).toBe(manifest.generatedAt);
    expect(manifest.files.map((file: { path: string }) => file.path)).toEqual([
      'server/src/guard.ts', 'server/test/guard.test.ts', 'server/test/other.test.ts',
    ]);
    expect(manifest.files[0]).toEqual({
      path: 'server/src/guard.ts', sha256: createHash('sha256').update(committed).digest('hex'),
      category: 'server', sizeBytes: Buffer.byteLength(committed),
    });
    expect(raw).not.toContain('example-user');
    expect(raw).not.toContain(committed.trim());
    expect(JSON.parse(generate()).changedFiles).toEqual(manifest.changedFiles);
  });

  it('excludes sensitive, generated and unsupported files from a root commit', () => {
    write('README.md', 'source description');
    for (const path of ['.env.example', 'server/src/.env.prod', 'server/src/private-keys.ts', 'server/src/account-data.ts',
      'server/src/wallet-backups/inventory.ts', 'server/src/dist/bundle.js', 'server/src/state.sqlite', 'web/src/logs/production.ts',
      'server/src/customer-data/record.ts', 'docs/export.pdf']) write(path, 'fixture content');
    write('server/src/binary.ts', Buffer.from([0, 255, 1]));
    write('server/src/large.ts', Buffer.alloc(1024 * 1024 + 1, ' '));
    symlinkSync('large.ts', join(cwd, 'server/src/link.ts'));
    write('server/src/path with spaces.ts', 'excluded path metadata');
    const sha = commit('root review');

    const out = JSON.parse(generate('--commit', sha));
    expect(out.files.map((file: { path: string }) => file.path)).toEqual(['README.md']);
    expect(out.changedFiles).toEqual(['README.md']);
    expect(out.relevantTests).toEqual([]);
    expect(out.excludedCategories).toContain('environment files and credentials');
    expect(() => generate('--commit', '--all')).toThrow();
  });
});
