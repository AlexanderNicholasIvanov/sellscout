// Run 5: the Settings api guards, the change set, the Settings panel and the new hint lines.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettingKey, SettingsResponse, SettingState } from '../server/types.ts';
import { SETTING_KEYS } from '../server/settings/keys.ts';
import { App } from './App.tsx';
import { getSettings, isSettingsResponse, NO_ANSWER, saveSettings, SettingsError } from './api.ts';
import { changedValues, draftFrom, SettingsPanel } from './Settings.tsx';

const SENTINEL = 'SENTINEL-SECRET-123';
const FILE = '/home/someone/.config/sellscout/settings.json';

const secret = (source: SettingState['source']): SettingState => ({ source, secret: true });
const text = (source: SettingState['source'], value?: string): SettingState =>
  value === undefined ? { source, secret: false } : { source, secret: false, value };

function response(
  overrides: Partial<Record<SettingKey, SettingState>> = {},
  editable = true,
): SettingsResponse {
  return {
    editable,
    file: editable ? FILE : null,
    settings: {
      ANTHROPIC_API_KEY: secret('none'),
      SELLSCOUT_CLAUDE_MODEL: text('none'),
      EBAY_CLIENT_ID: secret('none'),
      EBAY_CLIENT_SECRET: secret('none'),
      REDDIT_CLIENT_ID: secret('none'),
      REDDIT_CLIENT_SECRET: secret('none'),
      REDDIT_USERNAME: text('none'),
      ...overrides,
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('api guards: settings', () => {
  it('accepts a full response, editable or read-only', () => {
    expect(isSettingsResponse(response())).toBe(true);
    expect(isSettingsResponse(response({}, false))).toBe(true);
    expect(
      isSettingsResponse(
        response({ ANTHROPIC_API_KEY: secret('settings'), SELLSCOUT_CLAUDE_MODEL: text('environment', 'm') }),
      ),
    ).toBe(true);
  });

  it('needs all 7 keys, a valid source, a boolean secret and an optional string value', () => {
    for (const key of SETTING_KEYS) {
      const missing = response();
      delete (missing.settings as Partial<Record<SettingKey, SettingState>>)[key];
      expect(isSettingsResponse(missing)).toBe(false);
    }
    const bad: unknown[] = [
      { source: 'file', secret: false },
      { source: '', secret: false },
      { source: 'none', secret: 'false' },
      { source: 'none' },
      { source: 'settings', secret: false, value: 1 },
      { source: 'settings', secret: false, value: null },
      null,
      'none',
    ];
    for (const state of bad) {
      expect(isSettingsResponse(response({ REDDIT_USERNAME: state as SettingState }))).toBe(false);
    }
  });

  it('rejects a secret key that arrives with a value', () => {
    expect(isSettingsResponse(response({ ANTHROPIC_API_KEY: { source: 'settings', secret: true, value: SENTINEL } }))).toBe(
      false,
    );
    // Even when the server mislabels a secret key as not secret.
    expect(isSettingsResponse(response({ EBAY_CLIENT_SECRET: { source: 'settings', secret: false, value: SENTINEL } }))).toBe(
      false,
    );
    // And a key flagged secret never carries a value either.
    expect(isSettingsResponse(response({ REDDIT_USERNAME: { source: 'settings', secret: true, value: 'x' } }))).toBe(false);
  });

  it('rejects a bad top level', () => {
    const base = response();
    for (const body of [
      null,
      [],
      'x',
      { ...base, editable: 'true' },
      { ...base, file: 1 },
      { ...base, editable: true, file: null },
      { ...base, editable: false, file: FILE },
      { ...base, settings: null },
      { editable: true, file: FILE },
    ]) {
      expect(isSettingsResponse(body)).toBe(false);
    }
  });
});

describe('getSettings / saveSettings', () => {
  it('GETs /api/settings and checks the body', async () => {
    const fetchMock = vi.fn(async () => json(response()));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getSettings()).resolves.toEqual(response());
    expect(fetchMock).toHaveBeenCalledWith('/api/settings', expect.objectContaining({}));

    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Internal error' }, 500)));
    await expect(getSettings()).rejects.toBeInstanceOf(SettingsError);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(getSettings()).rejects.toBeInstanceOf(SettingsError);
    vi.stubGlobal('fetch', vi.fn(async () => json(response({ ANTHROPIC_API_KEY: { source: 'settings', secret: true, value: SENTINEL } }))));
    await expect(getSettings()).rejects.toBeInstanceOf(SettingsError);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(getSettings()).rejects.toBeInstanceOf(SettingsError);
  });

  it('PUTs JSON with only the given values', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json(response()));
    vi.stubGlobal('fetch', fetchMock);
    await expect(saveSettings({ ANTHROPIC_API_KEY: SENTINEL, REDDIT_USERNAME: null })).resolves.toEqual(response());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/settings');
    expect(init?.method).toBe('PUT');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({ values: { ANTHROPIC_API_KEY: SENTINEL, REDDIT_USERNAME: null } });
  });

  it("throws the server's error, or 'no answer from the server'", async () => {
    const message = (p: Promise<unknown>) => p.then(() => 'resolved', (err: Error) => err.message);
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'REDDIT_USERNAME must be a single line' }, 400)));
    await expect(message(saveSettings({ REDDIT_USERNAME: 'a' }))).resolves.toBe('REDDIT_USERNAME must be a single line');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(message(saveSettings({ REDDIT_USERNAME: 'a' }))).resolves.toBe(NO_ANSWER);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 502 })));
    await expect(message(saveSettings({ REDDIT_USERNAME: 'a' }))).resolves.toBe(NO_ANSWER);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{', { status: 200 })));
    await expect(message(saveSettings({ REDDIT_USERNAME: 'a' }))).resolves.toBe(NO_ANSWER);
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true })));
    await expect(message(saveSettings({ REDDIT_USERNAME: 'a' }))).resolves.toBe(NO_ANSWER);
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: '' }, 500)));
    await expect(message(saveSettings({ REDDIT_USERNAME: 'a' }))).resolves.toBe(NO_ANSWER);
  });
});

describe('the change set', () => {
  const settings = response({
    ANTHROPIC_API_KEY: secret('settings'),
    EBAY_CLIENT_ID: secret('environment'),
    SELLSCOUT_CLAUDE_MODEL: text('settings', 'claude-saved'),
    REDDIT_USERNAME: text('environment', 'from-env'),
  });

  it('a fresh draft sends nothing', () => {
    const draft = draftFrom(settings);
    expect(draft.texts).toEqual({ SELLSCOUT_CLAUDE_MODEL: 'claude-saved', REDDIT_USERNAME: 'from-env' });
    expect(changedValues(settings, draft)).toEqual({});
  });

  it('sends a non-empty secret input (trimmed), never an empty or blank one', () => {
    const draft = draftFrom(settings);
    draft.secrets = { EBAY_CLIENT_SECRET: `  ${SENTINEL}  `, REDDIT_CLIENT_ID: '   ', REDDIT_CLIENT_SECRET: '' };
    expect(changedValues(settings, draft)).toEqual({ EBAY_CLIENT_SECRET: SENTINEL });
  });

  it('sends null for a Remove, only for a saved key', () => {
    const draft = draftFrom(settings);
    draft.removals = ['ANTHROPIC_API_KEY', 'REDDIT_CLIENT_ID'];
    expect(changedValues(settings, draft)).toEqual({ ANTHROPIC_API_KEY: null });
  });

  it('sends a text field that differs from the server; empty means null', () => {
    const draft = draftFrom(settings);
    draft.texts.SELLSCOUT_CLAUDE_MODEL = ' claude-saved ';
    expect(changedValues(settings, draft)).toEqual({});
    draft.texts.SELLSCOUT_CLAUDE_MODEL = 'claude-other';
    expect(changedValues(settings, draft)).toEqual({ SELLSCOUT_CLAUDE_MODEL: 'claude-other' });
    draft.texts.SELLSCOUT_CLAUDE_MODEL = '';
    expect(changedValues(settings, draft)).toEqual({ SELLSCOUT_CLAUDE_MODEL: null });
  });

  it('never sends a field set in the environment', () => {
    const draft = draftFrom(settings);
    draft.secrets = { EBAY_CLIENT_ID: SENTINEL };
    draft.texts.REDDIT_USERNAME = 'changed';
    expect(changedValues(settings, draft)).toEqual({});
  });
});

describe('the Settings panel', () => {
  /** A fetch that answers GET with `get` (in turn, the last one repeats) and PUT with `put`. */
  function stubFetch(get: (Response | Error)[], put?: () => Response | Promise<Response>) {
    const gets = [...get];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/status') {
        return json({ version: '0.1.0', redditAuth: false, fixtures: false, ebay: false, claude: false });
      }
      if (init?.method === 'PUT') {
        if (!put) throw new Error('unexpected PUT');
        return put();
      }
      const next = gets.length > 1 ? gets.shift()! : gets[0];
      if (next instanceof Error) throw next;
      return next.clone();
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const puts = (fetchMock: ReturnType<typeof stubFetch>) =>
    fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([, init]) => JSON.parse(String(init?.body)));

  function renderPanel() {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<SettingsPanel onClose={onClose} onSaved={onSaved} />);
    return { onClose, onSaved };
  }

  const stateOf = (label: string) => {
    const input = screen.getByLabelText(label);
    const id = input.getAttribute('aria-describedby');
    return id ? document.getElementById(id)?.textContent : undefined;
  };

  it('shows Loading, then the intro, the fieldsets in order and focuses the heading', async () => {
    stubFetch([json(response())]);
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Settings' })).toHaveFocus();
    expect(screen.getByText('Loading settings…')).toBeInTheDocument();
    expect(await screen.findByText(`Keys are saved on this computer only, in ${FILE}.`)).toBeInTheDocument();
    expect(screen.queryByText('Loading settings…')).toBeNull();
    const groups = screen.getAllByRole('group');
    expect(groups.map((g) => g.querySelector('legend')?.textContent)).toEqual(['Anthropic (Claude)', 'eBay', 'Reddit']);
    const labels = [...document.querySelectorAll('.settings label')].map((l) => l.textContent);
    expect(labels).toEqual([
      'Anthropic API key',
      'Claude model',
      'eBay App ID (Client ID)',
      'eBay Cert ID (Client Secret)',
      'Reddit client ID',
      'Reddit client secret',
      'Reddit username',
    ]);
    expect(screen.getByLabelText('Claude model')).toHaveAttribute('placeholder', 'claude-opus-5-5');
    expect(screen.getByLabelText('Claude model')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Reddit username')).toHaveAttribute('type', 'text');
  });

  it('renders the secret field states, placeholders and the environment-disabled fields', async () => {
    stubFetch([
      json(
        response({
          ANTHROPIC_API_KEY: secret('settings'),
          EBAY_CLIENT_ID: secret('environment'),
          SELLSCOUT_CLAUDE_MODEL: text('settings', 'claude-saved'),
          REDDIT_USERNAME: text('environment', 'from-env'),
        }),
      ),
    ]);
    renderPanel();
    const key = await screen.findByLabelText('Anthropic API key');
    for (const label of [
      'Anthropic API key',
      'eBay App ID (Client ID)',
      'eBay Cert ID (Client Secret)',
      'Reddit client ID',
      'Reddit client secret',
    ]) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute('type', 'password');
      expect(input).toHaveAttribute('autocomplete', 'off');
      expect(input).toHaveValue('');
    }
    expect(stateOf('Anthropic API key')).toBe('Saved');
    expect(key).toHaveAttribute('placeholder', 'Paste to replace');
    expect(key).toBeEnabled();
    expect(stateOf('eBay App ID (Client ID)')).toBe('Set in the environment (read-only)');
    expect(screen.getByLabelText('eBay App ID (Client ID)')).toHaveAttribute('placeholder', 'Paste your key');
    expect(screen.getByLabelText('eBay App ID (Client ID)')).toBeDisabled();
    expect(stateOf('Reddit client ID')).toBe('Not set');
    expect(screen.getByLabelText('Reddit client ID')).toHaveAttribute('placeholder', 'Paste your key');
    expect(screen.getByLabelText('Claude model')).toHaveValue('claude-saved');
    expect(screen.getByLabelText('Claude model')).toBeEnabled();
    expect(screen.getByLabelText('Reddit username')).toHaveValue('from-env');
    expect(screen.getByLabelText('Reddit username')).toBeDisabled();
    // Only a saved key has Remove.
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Remove Anthropic API key' })).toHaveTextContent('Remove');
  });

  it('Remove marks a key for removal and Keep undoes it', async () => {
    stubFetch([json(response({ ANTHROPIC_API_KEY: secret('settings') }))]);
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Anthropic API key' }));
    expect(stateOf('Anthropic API key')).toBe('Will be removed when you save');
    const keep = screen.getByRole('button', { name: 'Keep Anthropic API key' });
    expect(keep).toHaveTextContent('Keep');
    await userEvent.click(keep);
    expect(stateOf('Anthropic API key')).toBe('Saved');
    expect(screen.getByRole('button', { name: 'Remove Anthropic API key' })).toBeInTheDocument();
  });

  it('with nothing changed says "Nothing to save." and sends no request', async () => {
    const fetchMock = stubFetch([json(response())]);
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Save settings' }));
    expect(screen.getByRole('status')).toHaveTextContent('Nothing to save.');
    expect(puts(fetchMock)).toEqual([]);
  });

  it('sends only the changes, then shows the success, clears the secrets and takes the new states', async () => {
    const saved = response({ ANTHROPIC_API_KEY: secret('none'), EBAY_CLIENT_SECRET: secret('settings'), SELLSCOUT_CLAUDE_MODEL: text('settings', 'claude-new') });
    const fetchMock = stubFetch([json(response({ ANTHROPIC_API_KEY: secret('settings') }))], () => json(saved));
    const { onSaved } = renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Anthropic API key' }));
    await userEvent.type(screen.getByLabelText('eBay Cert ID (Client Secret)'), SENTINEL);
    await userEvent.type(screen.getByLabelText('Claude model'), 'claude-new');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('Saved. New searches use these keys.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saved. New searches use these keys.');
    expect(puts(fetchMock)).toEqual([
      { values: { ANTHROPIC_API_KEY: null, EBAY_CLIENT_SECRET: SENTINEL, SELLSCOUT_CLAUDE_MODEL: 'claude-new' } },
    ]);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('eBay Cert ID (Client Secret)')).toHaveValue('');
    expect(stateOf('eBay Cert ID (Client Secret)')).toBe('Saved');
    expect(stateOf('Anthropic API key')).toBe('Not set');
    expect(screen.getByLabelText('Claude model')).toHaveValue('claude-new');
    expect(document.body.textContent).not.toContain(SENTINEL);
  });

  it('disables Save while saving', async () => {
    let answer: (r: Response) => void = () => {};
    stubFetch([json(response())], () => new Promise<Response>((resolve) => (answer = resolve)));
    renderPanel();
    await userEvent.type(await screen.findByLabelText('Reddit username'), 'someone');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
    answer(json(response({ REDDIT_USERNAME: text('settings', 'someone') })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled());
  });

  it("shows the server's error in an alert, and the no-answer message on a network failure", async () => {
    let put: () => Response = () => json({ error: 'REDDIT_USERNAME must be a single line' }, 400);
    const fetchMock = stubFetch([json(response())], () => put());
    const { onSaved } = renderPanel();
    await userEvent.type(await screen.findByLabelText('Reddit username'), 'someone');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't save settings: REDDIT_USERNAME must be a single line",
    );
    put = () => {
      throw new TypeError('Failed to fetch');
    };
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save settings: no answer from the server"),
    );
    expect(puts(fetchMock)).toHaveLength(2);
    expect(onSaved).not.toHaveBeenCalled();
    // The typed value stays for another try.
    expect(screen.getByLabelText('Reddit username')).toHaveValue('someone');
  });

  it('never mirrors a typed key into the markup (uncontrolled secret inputs)', async () => {
    stubFetch([json(response())]);
    const { container } = render(<SettingsPanel onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText('Anthropic API key'), SENTINEL);
    expect(screen.getByLabelText('Anthropic API key')).toHaveValue(SENTINEL);
    expect(container.innerHTML).not.toContain(SENTINEL);
  });

  it('locks the fields while saving, and still refreshes the chips if the panel closed meanwhile', async () => {
    let answer: (r: Response) => void = () => {};
    stubFetch([json(response())], () => new Promise<Response>((resolve) => (answer = resolve)));
    const onSaved = vi.fn();
    const { unmount } = render(<SettingsPanel onClose={vi.fn()} onSaved={onSaved} />);
    await userEvent.type(await screen.findByLabelText('Reddit username'), 'someone');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByLabelText('Reddit username')).toBeDisabled();
    expect(screen.getByLabelText('Anthropic API key')).toBeDisabled();
    unmount();
    answer(json(response({ REDDIT_USERNAME: text('settings', 'someone') })));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('Retry keeps focus inside the panel', async () => {
    stubFetch([json({ error: 'Internal error' }, 500), json(response())]);
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toHaveFocus();
  });

  it('shows the load failure and Retry loads again', async () => {
    const fetchMock = stubFetch([json({ error: 'Internal error' }, 500), json(response())]);
    renderPanel();
    expect(await screen.findByText("Couldn't load settings.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText('Anthropic API key')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load settings.")).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/settings')).toHaveLength(2);
  });

  it('a response with a secret value is a load failure: the value is never rendered', async () => {
    stubFetch([json(response({ ANTHROPIC_API_KEY: { source: 'settings', secret: true, value: SENTINEL } }))]);
    renderPanel();
    expect(await screen.findByText("Couldn't load settings.")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SENTINEL);
  });

  it('read-only: the intro says so and everything but Close is disabled', async () => {
    stubFetch([json(response({ ANTHROPIC_API_KEY: secret('settings'), REDDIT_USERNAME: text('settings', 'x') }, false))]);
    const { onClose } = renderPanel();
    expect(
      await screen.findByText('Settings are read-only here. Set keys in .env or the environment.'),
    ).toBeInTheDocument();
    for (const input of document.querySelectorAll('.settings input')) expect(input).toBeDisabled();
    for (const button of screen.getAllByRole('button')) {
      if (button.textContent === 'Close') expect(button).toBeEnabled();
      else expect(button).toBeDisabled();
    }
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape inside the panel closes it', async () => {
    stubFetch([json(response())]);
    const { onClose } = renderPanel();
    await userEvent.click(await screen.findByLabelText('Reddit username'));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the Settings button in the header', () => {
  it('toggles the panel above the form, and Close returns focus to the button', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === '/api/status'
        ? json({ version: '0.1.0', redditAuth: false, fixtures: false, ebay: false, claude: false })
        : json(response()),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    const button = screen.getByRole('button', { name: 'Settings' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'settings-panel');
    // After the status chips.
    expect(await screen.findByText('Claude: off (no key)')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Data sources' }).compareDocumentPosition(button)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById('settings-panel') as HTMLElement;
    expect(panel.tagName).toBe('SECTION');
    expect(within(panel).getByRole('heading', { name: 'Settings' })).toHaveFocus();
    // Above the search form.
    const form = screen.getByRole('form', { name: 'Search for boards' });
    expect(panel.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await screen.findByLabelText('Anthropic API key');

    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(document.getElementById('settings-panel')).toBeNull();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');

    // It loads again every time it opens; the button toggles it shut too.
    await userEvent.click(button);
    await screen.findByLabelText('Anthropic API key');
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/settings')).toHaveLength(2);
    await userEvent.click(button);
    expect(document.getElementById('settings-panel')).toBeNull();
  });

  it('fetches the status chips again after a successful save', async () => {
    let claude = false;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/status') return json({ version: '0.1.0', redditAuth: false, fixtures: false, ebay: false, claude });
      if (init?.method === 'PUT') {
        claude = true;
        return json(response({ ANTHROPIC_API_KEY: secret('settings') }));
      }
      return json(response());
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    expect(await screen.findByText('Claude: off (no key)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.type(await screen.findByLabelText('Anthropic API key'), SENTINEL);
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Claude: on')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/status')).toHaveLength(2);
  });
});

describe('the disabled hint lines', () => {
  it('point to Settings, with the README links unchanged', async () => {
    const body = {
      plan: { source: 'catalog', categories: [], searchTerm: 'tv' },
      venues: [],
      buyers: { status: 'disabled', term: 'tv', windowDays: 30, posts: [], links: [] },
      ebay: { status: 'disabled', term: 'tv', listings: [], searchUrl: 'https://www.ebay.com/sch/i.html?_nkw=tv' },
      notices: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/status'
          ? json({ version: '0.1.0', redditAuth: false, fixtures: false, ebay: false, claude: false })
          : json(body),
      ),
    );
    render(<App />);
    await userEvent.type(screen.getByLabelText('What are you selling?'), 'tv');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    const reddit = await screen.findByText(/^Add Reddit app keys/);
    expect(reddit).toHaveTextContent(
      "Add Reddit app keys in Settings to see live posts here. See the README's Reddit section.",
    );
    expect(within(reddit).getByRole('link')).toHaveAttribute(
      'href',
      'https://github.com/AlexanderNicholasIvanov/sellscout#reddit',
    );
    const ebay = screen.getByText(/^Add eBay app keys/);
    expect(ebay).toHaveTextContent(
      "Add eBay app keys in Settings to see similar listings and asking prices. See the README's eBay section.",
    );
    expect(within(ebay).getByRole('link')).toHaveAttribute(
      'href',
      'https://github.com/AlexanderNicholasIvanov/sellscout#ebay',
    );
  });
});
