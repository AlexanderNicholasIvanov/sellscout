// AC26: the README keeps the sections users and contributors rely on.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const headings = readme
  .split(/\r?\n/)
  .filter((line) => line.startsWith('## '))
  .map((line) => line.slice(3).trim());

describe('README', () => {
  it.each(['Setup', 'Running', 'Checks', 'Editing the catalog and metros', 'Reddit', 'Privacy', 'Roadmap'])(
    'has a "%s" section',
    (name) => {
      expect(headings).toContain(name);
    },
  );
});
