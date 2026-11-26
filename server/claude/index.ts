// The optional Claude planner (spec "The planner").
// - No key (and fixtures off): no planner, and the SDK client is never constructed.
// - ANTHROPIC_API_KEY set: the official SDK client, explicit key only, no retries, 30 s timeout.
// - Fixture mode: the in-repo stand-in client; nothing leaves the machine.
import Anthropic from '@anthropic-ai/sdk';
import type { ClientOptions } from '@anthropic-ai/sdk';
import { hasClaudeKey } from '../config.ts';
import type { AppConfig } from '../config.ts';
import { catalog as builtInCatalog } from '../data/catalog.ts';
import type { Catalog } from '../types.ts';
import { createFixtureClient } from './fixtures.ts';
import { CLAUDE_TIMEOUT_MS, createPlanner } from './planner.ts';
import type { Planner, PlannerClient } from './types.ts';

export { CLAUDE_TIMEOUT_MS, claudeNotice, createPlanner, REASON } from './planner.ts';
export type { ClaudePicks, Planner, PlannerOutcome } from './types.ts';

/** Requests always go to Anthropic's API, whatever ANTHROPIC_BASE_URL says. */
export const ANTHROPIC_API_URL = 'https://api.anthropic.com';

/**
 * The SDK options: an explicit key only (no auth token, profile or env lookup), the fixed API URL,
 * no retries, and SDK logging off (ANTHROPIC_LOG=debug would print the request body, the item).
 */
export function clientOptions(apiKey: string, fetch?: typeof globalThis.fetch): ClientOptions {
  return {
    apiKey,
    authToken: null,
    baseURL: ANTHROPIC_API_URL,
    maxRetries: 0,
    timeout: CLAUDE_TIMEOUT_MS,
    logLevel: 'off',
    ...(fetch ? { fetch } : {}),
  };
}

export interface ClaudePlannerOptions {
  config: AppConfig;
  /** Used for Anthropic requests when the key is set. Default: the SDK's (global fetch). */
  fetch?: typeof globalThis.fetch;
  /** Builds the SDK client (tests). Default: `new Anthropic(options)`. */
  createClient?: (options: ClientOptions) => PlannerClient;
  /** Default: the built-in catalog. */
  catalog?: Catalog;
}

/** The planner for this config, or undefined when Claude is off. */
export function createClaudePlanner(options: ClaudePlannerOptions): Planner | undefined {
  const { config } = options;
  const catalog = options.catalog ?? builtInCatalog;
  const model = config.claude.model;
  if (config.fixtures) return createPlanner({ client: createFixtureClient(catalog), model, catalog });
  if (!hasClaudeKey(config)) return undefined;
  const createClient = options.createClient ?? ((opts: ClientOptions): PlannerClient => new Anthropic(opts));
  return createPlanner({ client: createClient(clientOptions(config.claude.apiKey, options.fetch)), model, catalog });
}
