// The Claude planner's types: what it answers and the narrow client it talks to.
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';

/** A validated Claude answer: catalog category ids (Claude's order), one search term, extra subreddits. */
export interface ClaudePicks { categoryIds: string[]; searchTerm: string; subreddits: string[] }

/** `reason` is the text inside the failure notice, e.g. `timed out`. */
export type PlannerOutcome = { ok: true; picks: ClaudePicks } | { ok: false; reason: string };

/** Plans one search from the item text. Never rejects. */
export type Planner = (item: string) => Promise<PlannerOutcome>;

export type PlannerRequest = MessageCreateParamsNonStreaming;

/**
 * The one SDK call the planner makes. The real `Anthropic` client fits; tests and fixture mode
 * pass a stand-in. The answer is read defensively, so it is typed `unknown`.
 */
export interface PlannerClient {
  beta: { messages: { create(params: PlannerRequest, options?: { signal?: AbortSignal }): PromiseLike<unknown> } };
}
