// Bundles the desktop main process (desktop/main.ts, the server and @anthropic-ai/sdk included)
// into out/desktop/main.mjs, and copies the window icon next to it. `electron` stays external.
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = fileURLToPath(new URL('../out/desktop/', import.meta.url));

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: ['desktop/main.ts'],
  outfile: 'out/desktop/main.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  external: ['electron'],
  sourcemap: 'linked',
  logLevel: 'info',
  // No `createRequire` banner: no bundled dependency calls `require` at run time (checked: the
  // bundle has no `__require("...")` call). Add one here if a new CommonJS dependency needs it.
});

await copyFile(
  fileURLToPath(new URL('../desktop/resources/icon.png', import.meta.url)),
  fileURLToPath(new URL('../out/desktop/icon.png', import.meta.url)),
);
console.log('desktop: wrote out/desktop/main.mjs and out/desktop/icon.png');
