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
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The text of the first `text` content block, or undefined. */
function firstText(message: Record<string, unknown>): string | undefined {
  const { content } = message;
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
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

export function createPlanner(options: PlannerOptions): Planner {
  const { client, model, catalog } = options;
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
    try {
      message = await client.beta.messages.create(request(item.trim().replace(/\s+/g, ' ')));
    } catch (err) {
      return fail(reasonFor(err), describeError(err));
    }
    try {
      if (!isRecord(message)) return fail(REASON.unusable, 'no message');
      // stop_reason first: a cut-off or declined answer is never parsed.
      if (message.stop_reason === 'refusal') return fail(REASON.refusal, 'stop_reason refusal');
      if (message.stop_reason === 'max_tokens') return fail(REASON.maxTokens, 'stop_reason max_tokens');
      const text = firstText(message);
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
