// Runs the API server (node --watch, PORT or 5180) and the Vite dev server together.
// Ctrl+C, or either child exiting, stops both.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const isWindows = process.platform === 'win32';
/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let stopping = false;

/**
 * @param {string} name
 * @param {string[]} args
 */
function run(name, args) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, PORT: process.env.PORT || '5180' } });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.log(`[dev] ${name} exited (${signal ?? code}); stopping`);
      stop(code ?? 1);
    }
  });
  children.push(child);
}

/** @param {import('node:child_process').ChildProcess} child */
function kill(child) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  if (isWindows) {
    // Stop this child's own process tree by its PID (node --watch runs the server in a grandchild).
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

/** @param {number} code */
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) kill(child);
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

run('server', ['--watch', 'server/main.ts']);
// Run Vite's own bin with node directly: no npx shim and no shell, so the PID is Vite's.
run('vite', [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))]);
