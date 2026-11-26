// The desktop e2e runs the built app: the UI in dist/ and the bundled main process.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const required: Array<[string, string]> = [
  ['dist/index.html', 'npm run build'],
  ['out/desktop/main.mjs', 'npm run desktop:bundle'],
];

export default function globalSetup(): void {
  const missing = required.filter(([path]) => !existsSync(fileURLToPath(new URL(`../${path}`, import.meta.url))));
  if (missing.length > 0) {
    const lines = missing.map(([path, command]) => `  ${path} is missing: run \`${command}\``);
    throw new Error(`The desktop e2e needs the built app.\n${lines.join('\n')}`);
  }
}
