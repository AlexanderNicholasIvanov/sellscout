import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../../server/data/catalog.ts';
import { claudeNotice, createPlanner, REASON } from '../../server/claude/planner.ts';
import type { PlannerClient, PlannerRequest } from '../../server/claude/types.ts';
import {
  answerBody,
  CLAUDE_KEY,
  errorBody,
  hangUntilAborted,
  jsonResponse,
  messageBody,
  recordingFetch,
  sdkClient,
  spyConsole,
  textBlock,
} from './helpers.ts';
import type { Answer } from './helpers.ts';

const ITEM = 'private item text keyboard';
const GOOD = { categoryIds: ['keyboards'], searchTerm: 'mechanical keyboard', subreddits: ['MechanicalKeyboards'] };

afterEach(() => {
  vi.restoreAllMocks();
});

/** A planner on a fake client whose create() resolves to `message` (or runs `create`). */
function fakePlanner(create: (params: PlannerRequest) => Promise<unknown>) {
  const calls: PlannerRequest[] = [];
  const client: PlannerClient = {
    beta: {
      messages: {
        create: (params) => {
          calls.push(params);
          return create(params);
        },
      },
    },
  };
  return { planner: createPlanner({ client, model: 'claude-opus-5-5', catalog }), calls };
}

describe('the notice', () => {
  it('has the exact wording', () => {
    expect(claudeNotice('timed out')).toBe("Claude couldn't help with this search (timed out); used the built-in catalog.");
  });
});

describe('reading the answer (run 4 "The planner")', () => {
  it('a valid answer gives the validated picks', async () => {
    const { planner, calls } = fakePlanner(async () => answerBody({ ...GOOD, categoryIds: ['keyboards', 'nope'] }));
    expect(await planner(ITEM)).toEqual({ ok: true, picks: GOOD });
    expect(calls).toHaveLength(1);
  });

  it('reads stop_reason before the text: refusal is declined even with valid JSON', async () => {
    const { planner } = fakePlanner(async () => messageBody([textBlock(JSON.stringify(GOOD))], 'refusal'));
    expect(await planner(ITEM)).toEqual({ ok: false, reason: 'declined' });
  });

  it('reads stop_reason before the text: max_tokens is cut off even with valid JSON', async () => {
    const { planner } = fakePlanner(async () => messageBody([textBlock(JSON.stringify(GOOD))], 'max_tokens'));
    expect(await planner(ITEM)).toEqual({ ok: false, reason: 'answer cut off' });
  });

  it('uses the first text block, skipping other block types', async () => {
    const { planner } = fakePlanner(async () =>
      messageBody([{ type: 'thinking', thinking: '', signature: 's' }, textBlock(JSON.stringify(GOOD)), textBlock('not json')]),
    );
    expect(await planner(ITEM)).toEqual({ ok: true, picks: GOOD });
  });

  it.each([
    ['no content', messageBody([])],
    ['only a thinking block', messageBody([{ type: 'thinking', thinking: 'x', signature: 's' }])],
    ['content not an array', { ...messageBody([]), content: 'x' }],
    ['a text block without text', messageBody([{ type: 'text' }])],
    ['bad JSON', messageBody([textBlock('{"categoryIds": [')])],
    ['JSON of the wrong shape', messageBody([textBlock('{"categoryIds":"keyboards"}')])],
    ['an empty search term', answerBody({ ...GOOD, searchTerm: '  ' })],
    ['null', null],
    ['a string', 'hello'],
  ])('%s is an unusable answer', async (_label, message) => {
    const log = spyConsole();
    const { planner } = fakePlanner(async () => message);
    expect(await planner(ITEM)).toEqual({ ok: false, reason: 'unusable answer' });
    expect(log.all()).not.toContain('private item');
  });

  it('sends the trimmed, collapsed item as the only user message', async () => {
    const { planner, calls } = fakePlanner(async () => answerBody(GOOD));
    await planner('  Keychron   Q1\tkeyboard ');
    expect(calls[0]?.messages).toEqual([{ role: 'user', content: 'Keychron Q1 keyboard' }]);
  });

  it('sends the same system prompt and schema for every search', async () => {
    const { planner, calls } = fakePlanner(async () => answerBody(GOOD));
    await planner('one');
    await planner('two');
    expect(calls[0]?.system).toBe(calls[1]?.system);
    expect(JSON.stringify(calls[0]?.output_config)).toBe(JSON.stringify(calls[1]?.output_config));
  });
});

describe('thrown errors map to the Failures table (run 4 AC9, fake client)', () => {
  const headers = new Headers();
  it.each<[string, () => unknown, string]>([
    ['APIConnectionTimeoutError', () => new APIConnectionTimeoutError(), 'timed out'],
    ['APIConnectionError', () => new APIConnectionError({ message: 'Connection error.' }), "couldn't reach Anthropic"],
    ['AuthenticationError', () => new AuthenticationError(401, errorBody('authentication_error'), undefined, headers), 'API key rejected'],
    ['PermissionDeniedError', () => new PermissionDeniedError(403, errorBody('permission_error'), undefined, headers), 'API key rejected'],
    ['RateLimitError', () => new RateLimitError(429, errorBody('rate_limit_error'), undefined, headers), 'rate limited'],
    ['InternalServerError 500', () => new InternalServerError(500, errorBody('api_error'), undefined, headers), 'Anthropic returned HTTP 500'],
    ['APIError 400', () => APIError.generate(400, errorBody('invalid_request_error'), undefined, headers), 'Anthropic returned HTTP 400'],
    ['APIError 529', () => APIError.generate(529, errorBody('overloaded_error'), undefined, headers), 'Anthropic returned HTTP 529'],
    ['an APIError without a status', () => new APIError(undefined, undefined, 'x', undefined), 'unexpected error'],
    ['a TypeError', () => new TypeError('boom'), 'unexpected error'],
    ['a non-error value', () => `thrown ${CLAUDE_KEY}`, 'unexpected error'],
  ])('%s gives "%s"', async (_label, makeError, reason) => {
    const log = spyConsole();
    const { planner } = fakePlanner(async () => {
      throw makeError();
    });
    await expect(planner(ITEM)).resolves.toEqual({ ok: false, reason });
    const logged = log.all();
    expect(logged).not.toContain(CLAUDE_KEY);
    expect(logged).not.toContain('private item');
    expect(logged).not.toContain('Echo of');
  });

  it('a synchronous throw in create() also resolves', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client: PlannerClient = {
      beta: {
        messages: {
          create: () => {
            throw new Error('sync boom');
          },
        },
      },
    };
    await expect(createPlanner({ client, model: 'm', catalog })('x')).resolves.toEqual({ ok: false, reason: 'unexpected error' });
  });

  it('logs the class and status only for an API error', async () => {
    const log = spyConsole();
    const { planner } = fakePlanner(async () => {
      throw new RateLimitError(429, errorBody('rate_limit_error'), undefined, headers);
    });
    await planner(ITEM);
    expect(log.errorCalls()).toEqual([['Claude planner failed (rate limited): RateLimitError (HTTP 429)']]);
  });

  it('logs the stack for an unexpected error', async () => {
    const log = spyConsole();
    const { planner } = fakePlanner(async () => {
      throw new TypeError('boom');
    });
    await planner(ITEM);
    expect(log.errorCalls()).toHaveLength(1);
    expect(String(log.errorCalls()[0]?.[0])).toMatch(/^Claude planner failed \(unexpected error\): TypeError: boom\n\s+at /);
  });
});

describe('the Failures table through the real SDK client (run 4 AC9)', () => {
  const rows: [string, Answer, string][] = [
    ['HTTP 401', () => jsonResponse(errorBody('authentication_error'), 401), 'API key rejected'],
    ['HTTP 403', () => jsonResponse(errorBody('permission_error'), 403), 'API key rejected'],
    ['HTTP 429', () => jsonResponse(errorBody('rate_limit_error'), 429), 'rate limited'],
    ['HTTP 500', () => jsonResponse(errorBody('api_error'), 500), 'Anthropic returned HTTP 500'],
    ['HTTP 400', () => jsonResponse(errorBody('invalid_request_error'), 400), 'Anthropic returned HTTP 400'],
    ['HTTP 529', () => jsonResponse(errorBody('overloaded_error'), 529), 'Anthropic returned HTTP 529'],
    ['a network failure', () => Promise.reject(new TypeError('fetch failed')), "couldn't reach Anthropic"],
    ['stop_reason refusal', () => jsonResponse(messageBody([], 'refusal')), 'declined'],
    ['stop_reason max_tokens', () => jsonResponse(messageBody([textBlock('{"categoryIds":["ke')], 'max_tokens')), 'answer cut off'],
    ['no text block', () => jsonResponse(messageBody([])), 'unusable answer'],
    ['bad JSON', () => jsonResponse(messageBody([textBlock('not json')])), 'unusable answer'],
    ['an invalid shape', () => jsonResponse(messageBody([textBlock('{"categoryIds":"keyboards"}')])), 'unusable answer'],
  ];

  it.each(rows)('%s gives "%s", once, with nothing secret logged', async (_label, answer, reason) => {
    const log = spyConsole();
    const { fetch, calls } = recordingFetch(answer);
    const planner = createPlanner({ client: sdkClient(fetch), model: 'claude-opus-5-5', catalog });
    await expect(planner(ITEM)).resolves.toEqual({ ok: false, reason });
    // maxRetries: 0 — one request, never a retry.
    expect(calls).toHaveLength(1);
    const logged = log.all();
    expect(logged).not.toContain(CLAUDE_KEY);
    expect(logged).not.toContain('private item');
    expect(logged).not.toContain('Echo of');
    expect(logged).not.toContain('categoryIds');
  });

  it('a never-answering fetch with a short timeout gives "timed out" (run 4 AC10)', async () => {
    const log = spyConsole();
    const { fetch, calls } = recordingFetch(hangUntilAborted);
    const planner = createPlanner({ client: sdkClient(fetch, { timeout: 50 }), model: 'claude-opus-5-5', catalog });
    await expect(planner(ITEM)).resolves.toEqual({ ok: false, reason: REASON.timeout });
    expect(calls).toHaveLength(1);
    expect(log.errorCalls()).toEqual([['Claude planner failed (timed out): APIConnectionTimeoutError']]);
    expect(log.all()).not.toContain(CLAUDE_KEY);
  });

  it('a valid answer gives the picks', async () => {
    const { fetch } = recordingFetch(() => jsonResponse(answerBody(GOOD)));
    const planner = createPlanner({ client: sdkClient(fetch), model: 'claude-opus-5-5', catalog });
    expect(await planner(ITEM)).toEqual({ ok: true, picks: GOOD });
  });
});
