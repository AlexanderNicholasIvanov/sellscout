// The Settings panel (run 5): paste the Reddit, eBay and Anthropic keys. Secret values never
// reach the browser: the server only says whether each one is set, and where from.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { SettingKey, SettingsResponse, SettingState, SettingsUpdate } from '../server/types.ts';
import { SETTING_KEYS, isSecretSetting } from '../server/settings/keys.ts';
import { getSettings, saveSettings, SettingsError, NO_ANSWER } from './api.ts';

export const SETTINGS_PANEL_ID = 'settings-panel';

const FIELDSETS: { legend: string; fields: { key: SettingKey; label: string; placeholder?: string }[] }[] = [
  {
    legend: 'Anthropic (Claude)',
    fields: [
      { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API key' },
      { key: 'SELLSCOUT_CLAUDE_MODEL', label: 'Claude model', placeholder: 'claude-opus-5-5' },
    ],
  },
  {
    legend: 'eBay',
    fields: [
      { key: 'EBAY_CLIENT_ID', label: 'eBay App ID (Client ID)' },
      { key: 'EBAY_CLIENT_SECRET', label: 'eBay Cert ID (Client Secret)' },
    ],
  },
  {
    legend: 'Reddit',
    fields: [
      { key: 'REDDIT_CLIENT_ID', label: 'Reddit client ID' },
      { key: 'REDDIT_CLIENT_SECRET', label: 'Reddit client secret' },
      { key: 'REDDIT_USERNAME', label: 'Reddit username' },
    ],
  },
];

export const SAVED_TEXT = 'Saved. New searches use these keys.';
export const NOTHING_TEXT = 'Nothing to save.';
export const LOAD_FAILED_TEXT = "Couldn't load settings.";
export const READ_ONLY_TEXT = 'Settings are read-only here. Set keys in .env or the environment.';
export const ENV_TEXT = 'Set in the environment (read-only)';
export const REMOVE_TEXT = 'Will be removed when you save';

export const introText = (settings: SettingsResponse): string =>
  settings.editable && settings.file !== null
    ? `Keys are saved on this computer only, in ${settings.file}.`
    : READ_ONLY_TEXT;

/** The state line under a secret field. */
export function secretStateText(state: SettingState, removing: boolean): string {
  if (removing) return REMOVE_TEXT;
  switch (state.source) {
    case 'settings':
      return 'Saved';
    case 'environment':
      return ENV_TEXT;
    case 'none':
      return 'Not set';
  }
}

export const secretPlaceholder = (state: SettingState): string =>
  state.source === 'settings' ? 'Paste to replace' : 'Paste your key';

/**
 * What the user typed or marked: secret inputs, Removes, and the text fields as shown. The panel
 * keeps `secrets` empty in its state: the secret inputs are uncontrolled (React would otherwise
 * mirror a typed key into the input's `value` attribute) and are read only when saving.
 */
export interface Draft {
  secrets: Partial<Record<SettingKey, string>>;
  removals: SettingKey[];
  texts: Partial<Record<SettingKey, string>>;
}

/** A fresh draft for these settings: empty secrets, no removals, text fields as the server sent them. */
export function draftFrom(settings: SettingsResponse): Draft {
  const texts: Draft['texts'] = {};
  for (const key of SETTING_KEYS) {
    if (!isSecretSetting(key)) texts[key] = settings.settings[key].value ?? '';
  }
  return { secrets: {}, removals: [], texts };
}

/**
 * Only what changed: a non-empty secret input, a Remove (null), or a text field that differs from
 * what the server sent (empty means null). A field set in the environment is never sent.
 */
export function changedValues(settings: SettingsResponse, draft: Draft): SettingsUpdate['values'] {
  const values: SettingsUpdate['values'] = {};
  for (const key of SETTING_KEYS) {
    const state = settings.settings[key];
    if (state.source === 'environment') continue;
    if (isSecretSetting(key)) {
      if (state.source === 'settings' && draft.removals.includes(key)) {
        values[key] = null;
        continue;
      }
      const typed = (draft.secrets[key] ?? '').trim();
      if (typed !== '') values[key] = typed;
    } else {
      const shown = (draft.texts[key] ?? '').trim();
      if (shown !== (state.value ?? '')) values[key] = shown === '' ? null : shown;
    }
  }
  return values;
}

type Loaded = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; settings: SettingsResponse };

interface Message {
  kind: 'status' | 'alert';
  text: string;
  /** Bumped on every message so a repeated one re-mounts and is announced again. */
  key: number;
}

export function SettingsPanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [draft, setDraft] = useState<Draft>({ secrets: {}, removals: [], texts: {} });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const loadRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const secretInputs = useRef<Partial<Record<SettingKey, HTMLInputElement | null>>>({});

  /** The secret inputs as typed right now (the DOM is their only copy). */
  function typedSecrets(): Draft['secrets'] {
    const secrets: Draft['secrets'] = {};
    for (const [key, input] of Object.entries(secretInputs.current)) {
      if (input && input.value !== '') secrets[key as SettingKey] = input.value;
    }
    return secrets;
  }

  function clearSecretInputs() {
    for (const input of Object.values(secretInputs.current)) if (input) input.value = '';
  }

  function fetchSettings() {
    loadRef.current?.abort();
    const controller = new AbortController();
    loadRef.current = controller;
    getSettings(controller.signal).then(
      (settings) => {
        if (controller.signal.aborted) return;
        setDraft(draftFrom(settings));
        setLoaded({ kind: 'ready', settings });
      },
      () => {
        if (!controller.signal.aborted) setLoaded({ kind: 'failed' });
      },
    );
  }

  // Load every time the panel opens (it mounts on open), and move focus to the heading.
  useEffect(() => {
    mounted.current = true;
    headingRef.current?.focus();
    fetchSettings();
    return () => {
      mounted.current = false;
      loadRef.current?.abort();
    };
  }, []);

  // A focused button that gets disabled loses focus; put it back so Escape still closes the panel.
  useEffect(() => {
    if (!saving && (document.activeElement === null || document.activeElement === document.body)) {
      saveRef.current?.focus();
    }
  }, [saving]);

  function show(kind: Message['kind'], text: string) {
    setMessage((prev) => ({ kind, text, key: (prev?.key ?? 0) + 1 }));
  }

  function onRetry() {
    setLoaded({ kind: 'loading' });
    // Retry is about to disappear: keep focus inside the panel so Escape still closes it.
    headingRef.current?.focus();
    fetchSettings();
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onClose();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loaded.kind !== 'ready' || saving || !loaded.settings.editable) return;
    const values = changedValues(loaded.settings, { ...draft, secrets: typedSecrets() });
    if (Object.keys(values).length === 0) {
      show('status', NOTHING_TEXT);
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const settings = await saveSettings(values);
      // The header chips live in App: refresh them even if the panel was closed meanwhile.
      onSaved();
      if (!mounted.current) return;
      clearSecretInputs();
      setDraft(draftFrom(settings));
      setLoaded({ kind: 'ready', settings });
      show('status', SAVED_TEXT);
    } catch (err) {
      if (!mounted.current) return;
      show('alert', `Couldn't save settings: ${err instanceof SettingsError ? err.message : NO_ANSWER}`);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  const toggleRemove = (key: SettingKey) => {
    const input = secretInputs.current[key];
    if (input) input.value = '';
    setDraft((prev) => ({
      ...prev,
      removals: prev.removals.includes(key) ? prev.removals.filter((k) => k !== key) : [...prev.removals, key],
    }));
  };

  return (
    <section id={SETTINGS_PANEL_ID} className="settings" aria-labelledby="settings-heading" onKeyDown={onKeyDown}>
      <div className="settings-head">
        <h2 id="settings-heading" ref={headingRef} tabIndex={-1}>
          Settings
        </h2>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>

      {loaded.kind === 'loading' ? <p className="settings-loading">Loading settings…</p> : null}

      {loaded.kind === 'ready' ? (
        <form className="settings-form" onSubmit={onSubmit} noValidate>
          <p className="settings-intro">{introText(loaded.settings)}</p>
          {FIELDSETS.map((set) => (
            // Locked while saving, so nothing typed meanwhile is lost when the fields reset.
            <fieldset key={set.legend} className="settings-group" disabled={saving}>
              <legend>{set.legend}</legend>
              {set.fields.map((field) => {
                const state = loaded.settings.settings[field.key];
                const locked = !loaded.settings.editable || state.source === 'environment';
                const id = `setting-${field.key}`;
                const stateId = `${id}-state`;
                if (!isSecretSetting(field.key)) {
                  return (
                    <div key={field.key} className="field">
                      <label htmlFor={id}>{field.label}</label>
                      <input
                        id={id}
                        type="text"
                        autoComplete="off"
                        placeholder={field.placeholder}
                        disabled={locked}
                        aria-describedby={state.source === 'environment' ? stateId : undefined}
                        value={draft.texts[field.key] ?? ''}
                        onChange={(e) => {
                          const text = e.target.value;
                          setDraft((prev) => ({ ...prev, texts: { ...prev.texts, [field.key]: text } }));
                        }}
                      />
                      {state.source === 'environment' ? (
                        <p id={stateId} className="field-hint">
                          {ENV_TEXT}
                        </p>
                      ) : null}
                    </div>
                  );
                }
                const removing = state.source === 'settings' && draft.removals.includes(field.key);
                return (
                  <div key={field.key} className="field">
                    <label htmlFor={id}>{field.label}</label>
                    <div className="secret-row">
                      <input
                        id={id}
                        type="password"
                        autoComplete="off"
                        placeholder={secretPlaceholder(state)}
                        disabled={locked || removing}
                        aria-describedby={stateId}
                        ref={(el) => {
                          secretInputs.current[field.key] = el;
                        }}
                      />
                      {state.source === 'settings' ? (
                        <button
                          type="button"
                          className="secondary"
                          aria-label={`${removing ? 'Keep' : 'Remove'} ${field.label}`}
                          disabled={!loaded.settings.editable}
                          onClick={() => toggleRemove(field.key)}
                        >
                          {removing ? 'Keep' : 'Remove'}
                        </button>
                      ) : null}
                    </div>
                    <p id={stateId} className="field-hint">
                      {secretStateText(state, removing)}
                    </p>
                  </div>
                );
              })}
            </fieldset>
          ))}
          <div className="settings-actions">
            <button
              ref={saveRef}
              type="submit"
              className="submit"
              disabled={saving || !loaded.settings.editable}
            >
              Save settings
            </button>
          </div>
        </form>
      ) : null}

      <div role="status" className="settings-status">
        {message?.kind === 'status' ? (
          <p key={message.key} className="settings-message">
            {message.text}
          </p>
        ) : null}
      </div>
      <div role="alert" className="alert-region">
        {loaded.kind === 'failed' ? <p className="alert">{LOAD_FAILED_TEXT}</p> : null}
        {message?.kind === 'alert' ? (
          <p key={message.key} className="alert">
            {message.text}
          </p>
        ) : null}
      </div>
      {loaded.kind === 'failed' ? (
        <div className="settings-failed">
          <button type="button" className="secondary" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
    </section>
  );
}
