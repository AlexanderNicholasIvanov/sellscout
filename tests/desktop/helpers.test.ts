// AC13: the desktop app's pure helpers, tested without Electron.
import { describe, expect, it } from 'vitest';
import { APP_URL, isAppUrl, isExternalHttps, toServerUrl, windowOptions, withoutRunAsNode } from '../../desktop/helpers.ts';

describe('toServerUrl (AC13)', () => {
  it('maps the root to the server root', () => {
    expect(toServerUrl('sellscout://app/', 5555)).toBe('http://127.0.0.1:5555/');
    expect(toServerUrl(APP_URL, 1)).toBe('http://127.0.0.1:1/');
  });

  it('keeps the path and the query', () => {
    expect(toServerUrl('sellscout://app/api/status', 41234)).toBe('http://127.0.0.1:41234/api/status');
    expect(toServerUrl('sellscout://app/assets/index-abc.js?v=2&x=a%20b', 41234)).toBe(
      'http://127.0.0.1:41234/assets/index-abc.js?v=2&x=a%20b',
    );
  });

  it('drops the fragment', () => {
    expect(toServerUrl('sellscout://app/page?q=1#section', 8000)).toBe('http://127.0.0.1:8000/page?q=1');
  });

  it.each([
    'sellscout://elsewhere/api/status',
    'sellscout://app.evil/',
    'sellscout://app:99/',
    'sellscout://user@app/',
    'http://app/',
    'https://app/api/status',
    'file:///C:/Windows/',
    'not a url',
    '',
  ])('answers null for %s', (url) => {
    expect(toServerUrl(url, 5555)).toBeNull();
  });

  it('answers null for a port outside 1-65535', () => {
    expect(toServerUrl('sellscout://app/', 0)).toBeNull();
    expect(toServerUrl('sellscout://app/', 70000)).toBeNull();
    expect(toServerUrl('sellscout://app/', 1.5)).toBeNull();
  });
});

describe('isAppUrl', () => {
  it('is true only for sellscout://app', () => {
    expect(isAppUrl('sellscout://app/')).toBe(true);
    expect(isAppUrl('sellscout://app/api/status?x=1')).toBe(true);
    expect(isAppUrl('sellscout://other/')).toBe(false);
    expect(isAppUrl('https://app/')).toBe(false);
    expect(isAppUrl('http://127.0.0.1:5180/')).toBe(false);
    expect(isAppUrl('garbage')).toBe(false);
  });
});

describe('isExternalHttps (AC13)', () => {
  it.each(['https://www.reddit.com/r/mechmarket/', 'https://www.ebay.com/itm/123', 'HTTPS://Example.com/x?y=1'])(
    'opens %s in the default browser',
    (url) => {
      expect(isExternalHttps(url)).toBe(true);
    },
  );

  it.each([
    'http://example.com/',
    'http://127.0.0.1:5180/',
    'file:///C:/Windows/System32/calc.exe',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'sellscout://app/',
    'data:text/html,hi',
    'mailto:someone@example.com',
    'not a url',
    '',
  ])('denies %s', (url) => {
    expect(isExternalHttps(url)).toBe(false);
  });
});

describe('windowOptions (AC13)', () => {
  const options = windowOptions('/path/to/icon.png');

  it('sets the security flags: context isolation, no Node, sandbox, no preload', () => {
    expect(options.webPreferences.contextIsolation).toBe(true);
    expect(options.webPreferences.nodeIntegration).toBe(false);
    expect(options.webPreferences.sandbox).toBe(true);
    expect(options.webPreferences.webSecurity).toBe(true);
    expect(options.webPreferences.allowRunningInsecureContent).toBe(false);
    expect(options.webPreferences).not.toHaveProperty('preload');
  });

  it('has the title, the sizes and the icon', () => {
    expect(options).toMatchObject({
      title: 'sellscout',
      width: 1200,
      height: 860,
      minWidth: 400,
      minHeight: 600,
      icon: '/path/to/icon.png',
    });
  });
});

describe('withoutRunAsNode', () => {
  it('drops ELECTRON_RUN_AS_NODE in any case and keeps the rest', () => {
    const env = { ELECTRON_RUN_AS_NODE: '1', electron_run_as_node: '1', PATH: '/bin', SELLSCOUT_FIXTURES: '1' };
    expect(withoutRunAsNode(env)).toEqual({ PATH: '/bin', SELLSCOUT_FIXTURES: '1' });
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1');
  });
});
