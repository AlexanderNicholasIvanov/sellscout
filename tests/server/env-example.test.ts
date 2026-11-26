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

/** `env.NAME` reads in server/config.ts, where readConfig takes the environment as a parameter. */
const CONFIG_ENV_READ = /\benv\.([A-Z_][A-Z0-9_]*)/g;
const CONFIG_FILE = join(repoRoot, 'server', 'config.ts');

function configEnvReads(source: string): string[] {
  return [...source.matchAll(CONFIG_ENV_READ)].map((m) => m[1] ?? '');
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
    for (const name of configEnvReads(readFileSync(CONFIG_FILE, 'utf8'))) {
      seen.add(name);
      if (!ALLOWLIST.has(name) && !documented.has(name)) missing.push(`${name} (server/config.ts)`);
    }
    expect(seen.has('PORT')).toBe(true);
    expect(seen.has('REDDIT_CLIENT_ID')).toBe(true);
    expect(seen.has('EBAY_CLIENT_ID')).toBe(true);
    expect(seen.has('EBAY_CLIENT_SECRET')).toBe(true);
    expect(missing).toEqual([]);
  });

  it('the config scanner recognises env.NAME reads (run 2a AC17)', () => {
    expect(configEnvReads('env.PORT; deps.env.SELLSCOUT_FIXTURES; env.REDDIT_CLIENT_ID; myenv.NOPE; env.lower')).toEqual([
      'PORT',
      'SELLSCOUT_FIXTURES',
      'REDDIT_CLIENT_ID',
    ]);
  });

  it('sees every variable server/config.ts reads, and each is in .env.example', () => {
    const names = configEnvReads(readFileSync(CONFIG_FILE, 'utf8'));
    expect(new Set(names)).toEqual(
      new Set([
        'PORT',
        'SELLSCOUT_FIXTURES',
        'SELLSCOUT_FIXTURE_DELAY_MS',
        'REDDIT_CLIENT_ID',
        'REDDIT_CLIENT_SECRET',
        'REDDIT_USERNAME',
        'EBAY_CLIENT_ID',
        'EBAY_CLIENT_SECRET',
        'ANTHROPIC_API_KEY',
        'SELLSCOUT_CLAUDE_MODEL',
      ]),
    );
    const documented = documentedVars();
    expect(names.filter((name) => !documented.has(name))).toEqual([]);
  });

  it('says the fixture variables belong in the shell environment, not .env', () => {
    const text = readFileSync(join(repoRoot, '.env.example'), 'utf8');
    expect(text).toMatch(/shell environment, not in \.env/);
    for (const name of ['PORT', 'REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USERNAME', 'SELLSCOUT_FIXTURES', 'SELLSCOUT_FIXTURE_DELAY_MS']) {
      expect(text.split(/\r?\n/)).toContain(`${name}=`);
    }
  });

  it('lists both eBay keys with empty values under a one-line comment (run 3 AC2)', () => {
    const lines = readFileSync(join(repoRoot, '.env.example'), 'utf8').split(/\r?\n/);
    const id = lines.indexOf('EBAY_CLIENT_ID=');
    expect(id).toBeGreaterThan(0);
    expect(lines[id + 1]).toBe('EBAY_CLIENT_SECRET=');
    expect(lines[id - 1]).toMatch(/^# .*eBay/);
  });

  it('lists ANTHROPIC_API_KEY and SELLSCOUT_CLAUDE_MODEL empty, each under a one-line comment (run 4 AC2)', () => {
    const lines = readFileSync(join(repoRoot, '.env.example'), 'utf8').split(/\r?\n/);
    const key = lines.indexOf('ANTHROPIC_API_KEY=');
    const model = lines.indexOf('SELLSCOUT_CLAUDE_MODEL=');
    expect(key).toBeGreaterThan(0);
    expect(model).toBe(key + 2);
    expect(lines[key - 1]).toMatch(/^# .*Anthropic/);
    expect(lines[key - 2]).toBe('');
    expect(lines[model - 1]).toMatch(/^# .*claude-opus-5-5/);
  });
});
