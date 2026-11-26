// The Claude planner: one request per search, read as stop_reason, text, JSON, validation.
// Every failure becomes a reason for the notice; the planner never rejects. Logs carry the error
// class and status only (the stack for an unexpected error): never the item, the key or the answer.
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import type { Catalog } from '../types.ts';
import { buildSchema, buildSystemPrompt } from './prompt.ts';
import type { Planner, PlannerClient, PlannerOutcome, PlannerRequest } from './types.ts';
import { createValidator } from './validate.ts';

export const MAX_TOKENS = 8000;
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** The whole call, headers and body, must finish within this (the SDK timeout covers headers only). */
export const CLAUDE_TIMEOUT_MS = 30_000;

/** The `<reason>` of each failure (spec "Failures"). */
export const REASON = {
  timeout: 'timed out',
  connection: "couldn't reach Anthropic",
  auth: 'API key rejected',
  rateLimit: 'rate limited',
  http: (status: number): string => `Anthropic returned HTTP ${status}`,
  refusal: 'declined',
  maxTokens: 'answer cut off',
  unusable: 'unusable answer',
  unexpected: 'unexpected error',
} as const;

/** The notice shown with the catalog result when the planner fails. */
export const claudeNotice = (reason: string): string =>
  `Claude couldn't help with this search (${reason}); used the built-in catalog.`;

export interface PlannerOptions {
  client: PlannerClient;
  model: string;
  catalog: Catalog;
  /** Where failures are logged. Default: console.error. */
  log?: (message: string) => void;
  /** Overall deadline for one call, in ms. Default: CLAUDE_TIMEOUT_MS. */
  deadlineMs?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The text of the answer: the first `text` block after the last `fallback` block (with
 * server-side fallback, the declined model's partial output comes before that block), or of the
 * first `text` block when there is none. Undefined when there is no such block.
 */
function answerText(message: Record<string, unknown>): string | undefined {
  const { content } = message;
  if (!Array.isArray(content)) return undefined;
  let start = 0;
  content.forEach((block, index) => {
    if (isRecord(block) && block.type === 'fallback') start = index + 1;
  });
  for (const block of content.slice(start)) {
    if (isRecord(block) && block.type === 'text') return typeof block.text === 'string' ? block.text : undefined;
  }
  return undefined;
}

/** The failure reason for a thrown value. Connection classes first: they are APIErrors too. */
function reasonFor(err: unknown): string {
  if (err instanceof APIConnectionTimeoutError) return REASON.timeout;
  if (err instanceof APIConnectionError) return REASON.connection;
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) return REASON.auth;
  if (err instanceof RateLimitError) return REASON.rateLimit;
  if (err instanceof APIError && typeof err.status === 'number') return REASON.http(err.status);
  return REASON.unexpected;
}

/** The class name and status only (never `.message`, which can quote the API's answer). */
function describeError(err: unknown): string {
  if (err instanceof APIError) {
    const name = err.constructor.name || 'APIError';
    return typeof err.status === 'number' ? `${name} (HTTP ${err.status})` : name;
  }
  return err instanceof Error ? (err.stack ?? err.name) : 'Non-error value thrown';
}

/** A response body that is not JSON: the SDK's SyntaxError message quotes the body, so log the name only. */
function failureFor(err: unknown): { reason: string; detail: string } {
  if (err instanceof SyntaxError) return { reason: REASON.unusable, detail: 'SyntaxError (response body is not JSON)' };
  return { reason: reasonFor(err), detail: describeError(err) };
}

const DEADLINE = Symbol('deadline');

export function createPlanner(options: PlannerOptions): Planner {
  const { client, model, catalog } = options;
  const deadlineMs = options.deadlineMs ?? CLAUDE_TIMEOUT_MS;
  const log = options.log ?? ((message: string) => console.error(message));
  // Built once: the same bytes for every search.
  const system = buildSystemPrompt(catalog);
  const schema = buildSchema(catalog);
  const validate = createValidator(catalog);

  const fail = (reason: string, detail: string): PlannerOutcome => {
    log(`Claude planner failed (${reason}): ${detail}`);
    return { ok: false, reason };
  };

  /** One request. Only the item goes in the user message: never the location or anything else. */
  const request = (item: string): PlannerRequest => ({
    model,
    max_tokens: MAX_TOKENS,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: item }],
  });

  return async (item) => {
    let message: unknown;
    // The SDK timeout stops at the response headers; this deadline also covers the body.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<typeof DEADLINE>((resolve) => {
      timer = setTimeout(() => resolve(DEADLINE), deadlineMs);
    });
    try {
      const call = client.beta.messages.create(request(item.trim().replace(/\s+/g, ' ')), { signal: controller.signal });
      const result = await Promise.race([call, deadline]);
      if (result === DEADLINE) {
        controller.abort();
        return fail(REASON.timeout, 'deadline passed');
      }
      message = result;
    } catch (err) {
      const { reason, detail } = failureFor(err);
      return fail(reason, detail);
    } finally {
      clearTimeout(timer);
    }
    try {
      if (!isRecord(message)) return fail(REASON.unusable, 'no message');
      // stop_reason first: a cut-off or declined answer is never parsed.
      if (message.stop_reason === 'refusal') return fail(REASON.refusal, 'stop_reason refusal');
      if (message.stop_reason === 'max_tokens') return fail(REASON.maxTokens, 'stop_reason max_tokens');
      const text = answerText(message);
      if (text === undefined) return fail(REASON.unusable, 'no text block');
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return fail(REASON.unusable, 'answer is not JSON');
      }
      const picks = validate(parsed);
      if (!picks) return fail(REASON.unusable, 'answer does not match the schema');
      return { ok: true, picks };
    } catch (err) {
      return fail(REASON.unexpected, describeError(err));
    }
  };
}
