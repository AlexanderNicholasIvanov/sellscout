import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const ALLOWLIST = new Set(['CI', 'NODE_ENV']);

/** `process.env.X`, `process.env['X']` and `process.env["X"]`. */
const ENV_READ = /process\.env(?:\.([A-Za-z_$][\w$]*)|\[\s*['"]([^'"]+)['"]\s*\])/g;

function envReads(source: string): string[] {
  return [...source.matchAll(ENV_READ)].map((m) => m[1] ?? m[2] ?? '');
}

function scannedFiles(): string[] {
  const serverFiles = readdirSync(join(repoRoot, 'server'), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(repoRoot, 'server', f));
  return [...serverFiles, join(repoRoot, 'vite.config.ts'), join(repoRoot, 'playwright.config.ts')];
}

function documentedVars(): Set<string> {
  const lines = readFileSync(join(repoRoot, '.env.example'), 'utf8').split(/\r?\n/);
  return new Set(
    lines
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => line.split('=')[0]?.trim() ?? ''),
  );
}

describe('.env.example (AC25)', () => {
  it('the scanner recognises every env-read form', () => {
    expect(envReads(`process.env.PORT; process.env['A_B']; process.env[ "C" ]`)).toEqual(['PORT', 'A_B', 'C']);
  });

  it('lists every env var the server and configs read', () => {
    const documented = documentedVars();
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const file of scannedFiles()) {
      for (const name of envReads(readFileSync(file, 'utf8'))) {
        seen.add(name);
        if (!ALLOWLIST.has(name) && !documented.has(name)) missing.push(`${name} (${relative(repoRoot, file)})`);
      }
    }
    expect(seen.has('PORT')).toBe(true);
    expect(missing).toEqual([]);
  });
});
