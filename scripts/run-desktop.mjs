// `npm run desktop`: opens the desktop app from this checkout (run after the UI build and
// `npm run desktop:bundle`). Electron-based terminals (VS Code, T3 Code) set ELECTRON_RUN_AS_NODE,
// which would make Electron run as plain Node, so the child environment drops it.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
/** The `electron` package's default export is the path to its binary. */
const electronPath = /** @type {string} */ (require('electron'));
const root = fileURLToPath(new URL('..', import.meta.url));

/** @type {Record<string, string | undefined>} */
const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
}

const child = spawn(electronPath, ['.'], { cwd: root, stdio: 'inherit', env });
child.on('error', (err) => {
  console.error(`Couldn't start Electron: ${err.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
