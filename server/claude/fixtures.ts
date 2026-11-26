// Fixture mode: the in-repo stand-in for the Anthropic client (spec "Fixture mode"). The real
// planner builds the request and reads the answer; this answers by the user message (the item),
// case-insensitive, with SDK-shaped messages or real SDK error instances. No network, no waiting.
import { APIConnectionError, APIConnectionTimeoutError, APIError } from '@anthropic-ai/sdk';
import { buyerTerm } from '../reddit/term.ts';
import type { Catalog } from '../types.ts';
import { compileCategories, matchCategories } from '../venues/match.ts';
import type { PlannerClient, PlannerRequest } from './types.ts';

/** Builds the SDK error for an HTTP status the way the SDK does (status -> error class). */
function httpError(status: number, type: string): APIError {
  const body = { type: 'error', error: { type, message: `Fixture ${type}` } };
  return APIError.generate(status, body, undefined, new Headers({ 'request-id': 'req_fixture' }));
}

/** The thrown error for a failure term, or undefined. */
function fixtureError(text: string): Error | undefined {
  if (text.includes('claude-timeout')) return new APIConnectionTimeoutError();
  if (text.includes('claude-offline')) return new APIConnectionError({ message: 'Connection error.' });
  if (text.includes('claude-401')) return httpError(401, 'authentication_error');
  if (text.includes('claude-429')) return httpError(429, 'rate_limit_error');
  if (text.includes('claude-500')) return httpError(500, 'api_error');
  return undefined;
}

/** A BetaMessage-shaped answer. */
function message(model: string, stopReason: string, content: { type: 'text'; text: string }[]): Record<string, unknown> {
  return {
    id: 'msg_fixture',
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: stopReason === 'refusal' ? { type: 'refusal', category: null, explanation: null } : null,
    container: null,
    context_management: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

const textMessage = (model: string, answer: unknown): Record<string, unknown> =>
  message(model, 'end_turn', [{ type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer) }]);

/** The item text: the first user message's string content. */
function userText(params: PlannerRequest): string {
  const content = params.messages[0]?.content;
  return typeof content === 'string' ? content : '';
}

export function createFixtureClient(catalog: Catalog): PlannerClient {
  const compiled = compileCategories(catalog.categories);
  return {
    beta: {
      messages: {
        create: async (params) => {
          const item = userText(params);
          const text = item.toLowerCase();
          const error = fixtureError(text);
          if (error) throw error;
          if (text.includes('claude-refusal')) return message(params.model, 'refusal', []);
          if (text.includes('claude-max-tokens')) {
            return message(params.model, 'max_tokens', [{ type: 'text', text: '{"categoryIds":["keyb' }]);
          }
          if (text.includes('claude-invalid')) return textMessage(params.model, '{"categoryIds":"keyboards"}');
          if (text.includes('mechanical keyboard')) {
            return textMessage(params.model, {
              categoryIds: ['keyboards', 'not-a-category'],
              searchTerm: 'mechanical keyboard',
              subreddits: ['MechanicalKeyboards', 'r/mechmarket', 'bad name!'],
            });
          }
          return textMessage(params.model, {
            categoryIds: matchCategories(item, compiled).map((match) => match.category.id),
            searchTerm: buyerTerm(item),
            subreddits: [],
          });
        },
      },
    },
  };
}
