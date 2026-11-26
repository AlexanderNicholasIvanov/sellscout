// sellscout desktop app: the Electron main process. It starts the sellscout server in-process on
// a random loopback port and shows the UI in one window loaded from `sellscout://app/`, which a
// protocol handler proxies to that server. Bundled by scripts/build-desktop.mjs.
import { app, BrowserWindow, dialog, Menu, protocol, session, shell } from 'electron';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../server/config.ts';
import { installFetchGuard } from '../server/fetch-guard.ts';
import { resolveSettingsFile } from '../server/settings/path.ts';
import { startServer } from '../server/start.ts';
import { APP_SCHEME, APP_URL, isAppUrl, isExternalHttps, windowOptions } from './helpers.ts';
import { forwardToServer } from './proxy.ts';

// 1. User data first, before the single-instance lock (the lock lives in that folder). The tests
//    point it at a temp folder so they never touch the real %APPDATA%\sellscout.
const userDataDir = process.env.SELLSCOUT_USER_DATA_DIR?.trim();
if (userDataDir) app.setPath('userData', userDataDir);

// 2. One instance: a second launch focuses the existing window and quits.
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  // 3. The scheme must be privileged before `ready`.
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
  run();
}

function run(): void {
  // The settings env is process.env as is: SELLSCOUT_FIXTURES comes from the real environment,
  // and `.env` is never loaded by the desktop app.
  const env = process.env;
  let server: Server | undefined;
  let mainWindow: BrowserWindow | null = null;

  const iconPath = fileURLToPath(new URL('./icon.png', import.meta.url));

  function createWindow(): void {
    const win = new BrowserWindow(windowOptions(iconPath));
    mainWindow = win;
    win.on('closed', () => {
      if (mainWindow === win) mainWindow = null;
    });
    const contents = win.webContents;
    // window.open / target="_blank": https opens in the default browser; nothing opens a window.
    contents.setWindowOpenHandler(({ url }) => {
      if (isExternalHttps(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    // The window never leaves sellscout://app; an https target goes to the default browser.
    const guardNavigation = (event: { url: string; preventDefault: () => void }): void => {
      if (isAppUrl(event.url)) return;
      event.preventDefault();
      if (isExternalHttps(event.url)) void shell.openExternal(event.url);
    };
    contents.on('will-navigate', guardNavigation);
    contents.on('will-redirect', guardNavigation);
    // Sub-frames (the UI has none) may never leave sellscout://app either, and open nothing.
    contents.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame && !isAppUrl(event.url)) event.preventDefault();
    });
    void win.loadURL(APP_URL);
  }

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  // Windows and Linux quit with the last window; macOS keeps the usual dock behaviour.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (server && BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('will-quit', () => {
    if (!server) return;
    server.close();
    server.closeAllConnections();
    server = undefined;
  });

  app
    .whenReady()
    .then(async () => {
      Menu.setApplicationMenu(null);
      // Every permission (geolocation, notifications, camera, ...) is denied.
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      session.defaultSession.setPermissionCheckHandler(() => false);
      // The app never downloads anything: refuse every download (no save dialog).
      session.defaultSession.on('will-download', (event) => event.preventDefault());

      const config = readConfig(env);
      // Fixture mode: no request may leave the machine, as with `npm start`.
      if (config.fixtures) installFetchGuard();
      server = await startServer({
        port: 0,
        host: '127.0.0.1',
        version: app.getVersion(),
        distDir: join(app.getAppPath(), 'dist'),
        config,
        settings: { file: resolveSettingsFile(env), env },
      });
      const { port } = server.address() as AddressInfo;

      // sellscout://app/<path>?<query> -> http://127.0.0.1:<port>/<path>?<query>; other hosts 404.
      protocol.handle(APP_SCHEME, (request) => forwardToServer(request, port));

      createWindow();
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      dialog.showErrorBox("sellscout couldn't start", message);
      app.quit();
    });
}
