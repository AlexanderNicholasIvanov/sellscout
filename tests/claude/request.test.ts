import Anthropic from '@anthropic-ai/sdk';
import type { ClientOptions } from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readConfig } from '../../server/config.ts';
import { catalog } from '../../server/data/catalog.ts';
import { CLAUDE_TIMEOUT_MS, clientOptions, createClaudePlanner } from '../../server/claude/index.ts';
import { buildSchema } from '../../server/claude/prompt.ts';
import type { PlannerClient } from '../../server/claude/types.ts';
import { createSearchService } from '../../server/search.ts';
import { searchVenues } from '../../server/venues/index.ts';
import { disabledEbay } from '../ebay/helpers.ts';
import { answerBody, CLAUDE_KEY, errorBody, jsonResponse, MESSAGES_URL, recordingFetch } from './helpers.ts';

const GOOD = { categoryIds: ['keyboards'], searchTerm: 'mechanical keyboard', subreddits: [] };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** The planner exactly as the app builds it (real SDK client), on a recording fetch. */
function realPlanner(env: Record<string, string>, answer = () => jsonResponse(answerBody(GOOD))) {
  // Pin the default base URL even if the developer's shell sets one; the fetch is injected anyway.
  vi.stubEnv('ANTHROPIC_BASE_URL', '');
  const recorded = recordingFetch(answer);
  const planner = createClaudePlanner({ config: readConfig(env), fetch: recorded.fetch });
  if (!planner) throw new Error('expected a planner');
  return { planner, calls: recorded.calls };
}

describe('the Claude request through the real SDK (run 4 AC5)', () => {
  it('posts to /v1/messages with the key, the fallback beta and the agreed body', async () => {
    const { planner, calls } = realPlanner({ ANTHROPIC_API_KEY: CLAUDE_KEY });
    expect(await planner('Keychron mechanical keyboard')).toEqual({ ok: true, picks: GOOD });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    if (!call) throw new Error('no call');

    expect(call.method).toBe('POST');
    expect(new URL(call.url).origin + new URL(call.url).pathname).toBe(MESSAGES_URL);
    // SDK 1.14.0 sends an explicit apiKey as `Authorization: Bearer <key>` (client.js apiKeyAuth),
    // not as `x-api-key`: the key reaches Anthropic exactly once, in that header.
    expect(call.headers.authorization).toBe(`Bearer ${CLAUDE_KEY}`);
    expect(call.headers['x-api-key']).toBeUndefined();
    expect(call.headers['anthropic-beta']?.split(',').map((s) => s.trim())).toContain('server-side-fallback-2026-07-01');

    const { body } = call;
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.max_tokens).toBe(8000);
    expect(body.fallbacks).toBe('default');
    expect(body.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema: buildSchema(catalog) } });
    const schema = (body.output_config as { format: { schema: { properties: { categoryIds: { items: { enum: string[] } } } } } }).format.schema;
    expect(schema.properties.categoryIds.items.enum).toEqual(catalog.categories.map((c) => c.id));
    expect(body.messages).toEqual([{ role: 'user', content: 'Keychron mechanical keyboard' }]);
    expect(typeof body.system).toBe('string');
    for (const field of ['temperature', 'top_p', 'top_k', 'thinking', 'betas', 'stream']) expect(body).not.toHaveProperty(field);
    expect(JSON.stringify(body)).not.toContain(CLAUDE_KEY);
  });

  it('uses SELLSCOUT_CLAUDE_MODEL when set', async () => {
    const { planner, calls } = realPlanner({ ANTHROPIC_API_KEY: CLAUDE_KEY, SELLSCOUT_CLAUDE_MODEL: ' claude-sonnet-5-5 ' });
    await planner('desk');
    expect(calls[0]?.body.model).toBe('claude-sonnet-5-5');
  });

  it('never sends the location, delivery, window or anything but the item', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', '');
    const recorded = recordingFetch(() => jsonResponse(answerBody(GOOD)));
    const planner = createClaudePlanner({ config: readConfig({ ANTHROPIC_API_KEY: CLAUDE_KEY }), fetch: recorded.fetch });
    const search = createSearchService({
      venues: searchVenues,
      buyers: async (query) => ({
        buyers: { status: 'disabled', term: query.term ?? '', windowDays: query.windowDays, posts: [], links: [] },
        notices: [],
      }),
      ebay: disabledEbay(),
      ...(planner ? { planner } : {}),
    });
    const result = await search({ item: 'mechanical keyboard', location: 'Zanzibarville 98101', delivery: 'local', window: 7 });
    expect(result.plan.source).toBe('claude');
    expect(recorded.calls).toHaveLength(1);
    const sent = JSON.stringify(recorded.calls[0]?.body);
    expect(sent).not.toContain('Zanzibarville');
    expect(sent).not.toContain('98101');
    expect(recorded.calls[0]?.body.messages).toEqual([{ role: 'user', content: 'mechanical keyboard' }]);
  });

  it('a 500 answer is exactly one fetch (maxRetries: 0)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { planner, calls } = realPlanner({ ANTHROPIC_API_KEY: CLAUDE_KEY }, () => jsonResponse(errorBody('api_error'), 500));
    expect(await planner('desk')).toEqual({ ok: false, reason: 'Anthropic returned HTTP 500' });
    expect(calls).toHaveLength(1);
  });
});

describe('the SDK client options (run 4 AC4, AC10)', () => {
  it('are an explicit key, no auth token, no retries and a 30 s timeout', () => {
    expect(CLAUDE_TIMEOUT_MS).toBe(30_000);
    expect(clientOptions(CLAUDE_KEY)).toEqual({ apiKey: CLAUDE_KEY, authToken: null, maxRetries: 0, timeout: 30_000 });
  });

  it('the real client is built with them', () => {
    const built: ClientOptions[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>();
    const planner = createClaudePlanner({
      config: readConfig({ ANTHROPIC_API_KEY: CLAUDE_KEY }),
      fetch,
      createClient: (options) => {
        built.push(options);
        return new Anthropic(options);
      },
    });
    expect(planner).toBeTypeOf('function');
    expect(built).toEqual([{ apiKey: CLAUDE_KEY, authToken: null, maxRetries: 0, timeout: 30_000, fetch }]);
    const client = new Anthropic(built[0]);
    expect(client.maxRetries).toBe(0);
    expect(client.timeout).toBe(30_000);
    expect(client.authToken).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('an ANTHROPIC_AUTH_TOKEN in the environment never turns Claude on or reaches the request', async () => {
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'SENTINEL-AUTH-TOKEN');
    expect(createClaudePlanner({ config: readConfig({ ANTHROPIC_AUTH_TOKEN: 'SENTINEL-AUTH-TOKEN' }) })).toBeUndefined();
    const { planner, calls } = realPlanner({ ANTHROPIC_API_KEY: CLAUDE_KEY });
    await planner('desk');
    expect(JSON.stringify(calls[0]?.headers)).not.toContain('SENTINEL-AUTH-TOKEN');
  });

  it('with no key (fixtures off) there is no planner and no SDK client is constructed (run 4 AC4)', () => {
    const createClient = vi.fn<(options: ClientOptions) => PlannerClient>();
    const fetch = vi.fn<typeof globalThis.fetch>();
    for (const env of [{}, { ANTHROPIC_API_KEY: '   ' }, { SELLSCOUT_CLAUDE_MODEL: 'claude-opus-5-5' }]) {
      expect(createClaudePlanner({ config: readConfig(env), fetch, createClient })).toBeUndefined();
    }
    expect(createClient).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('in fixture mode the stand-in is used: no SDK client, no fetch, even with a key in the env', async () => {
    const createClient = vi.fn<(options: ClientOptions) => PlannerClient>();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const planner = createClaudePlanner({
      config: readConfig({ SELLSCOUT_FIXTURES: '1', ANTHROPIC_API_KEY: CLAUDE_KEY }),
      fetch,
      createClient,
    });
    expect(planner).toBeTypeOf('function');
    expect(await planner?.('mechanical keyboard')).toMatchObject({ ok: true });
    expect(createClient).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
