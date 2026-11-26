// Shared fakes for the Claude planner tests: the real SDK client on an injected fetch, canned
// Messages API answers and console spies. Nothing here reaches the network.
import Anthropic from '@anthropic-ai/sdk';
import { vi } from 'vitest';
import { clientOptions } from '../../server/claude/index.ts';
import type { PlannerClient } from '../../server/claude/types.ts';

export const CLAUDE_KEY = 'SENTINEL-ANTHROPIC-KEY';
export const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A Messages API JSON body (beta message) with the given stop reason and content. */
export function messageBody(content: unknown[], stopReason = 'end_turn'): Record<string, unknown> {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

export const textBlock = (text: string): Record<string, unknown> => ({ type: 'text', text });

export const answerBody = (answer: unknown): Record<string, unknown> => messageBody([textBlock(JSON.stringify(answer))]);

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'request-id': 'req_test' },
  });
}

export const errorBody = (type: string): Record<string, unknown> => ({
  type: 'error',
  error: { type, message: `Echo of ${CLAUDE_KEY} and the private item text` },
});

export type Answer = (call: RecordedCall, signal: AbortSignal | undefined) => Response | Promise<Response>;

/** A fetch that records every call (URL, headers, parsed JSON body) and answers through `answer`. */
export function recordingFetch(answer: Answer): { fetch: typeof globalThis.fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const text = typeof init?.body === 'string' ? init.body : '';
    const call: RecordedCall = { url, method: init?.method ?? 'GET', headers, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
    calls.push(call);
    return answer(call, init?.signal ?? undefined);
  });
  return { fetch, calls };
}

/** Never answers; rejects like the real fetch once the SDK aborts the request. */
export const hangUntilAborted: Answer = (_call, signal) =>
  new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')), { once: true });
  });

/**
 * The real SDK client exactly as the app builds it (clientOptions), on an injected fetch, with
 * the base URL pinned so a developer's ANTHROPIC_BASE_URL cannot change the recorded URL.
 */
export function sdkClient(fetch: typeof globalThis.fetch, overrides: { timeout?: number } = {}): PlannerClient {
  return new Anthropic({ ...clientOptions(CLAUDE_KEY, fetch), baseURL: 'https://api.anthropic.com', ...overrides });
}

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;

/** Spies on every console method (silenced) and returns everything they were called with. */
export function spyConsole(): { all: () => string; errorCalls: () => unknown[][] } {
  const spies = CONSOLE_METHODS.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  return {
    all: () => spies.flatMap((spy) => spy.mock.calls.flat().map((arg) => (arg instanceof Error ? `${arg.stack ?? ''} ${arg.message}` : typeof arg === 'string' ? arg : JSON.stringify(arg)))).join('\n'),
    errorCalls: () => (spies[3]?.mock.calls ?? []) as unknown[][],
  };
}
