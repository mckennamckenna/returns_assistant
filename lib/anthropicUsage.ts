import type { Usage } from "@anthropic-ai/sdk/resources/messages";

export type AnthropicCallSite =
  | "commerce_classifier"
  | "email_extraction"
  | "email_extraction_retry"
  | "policy_lookup";

interface LogAnthropicUsageParams {
  callSite: AnthropicCallSite;
  model: string;
  usage: Usage;
  // Only meaningful for commerce_classifier / email_extraction / email_extraction_retry.
  bodyCharacterCount?: number;
  // Only meaningful for policy_lookup.
  retailer?: string | null;
  emailId?: string | null;
}

// Cost-visibility logging only. Counts and IDs, never content — see BUILD.md
// Privacy invariants #2 ("never log email content"): body, prompt, subject,
// sender/recipient, and line items must never reach this function or its
// caller.
//
// webSearchRequests reads usage.server_tool_use?.web_search_requests —
// confirmed against the installed @anthropic-ai/sdk (0.105.0) type
// definitions (resources/messages/messages.d.ts), not assumed from memory.
// A mocked test can only prove this function reads the field correctly, not
// that a live web-search call actually populates it with a nonzero count —
// see TASKS.md for the required post-deploy spot check.
export function logAnthropicUsage(params: LogAnthropicUsageParams): void {
  const event = {
    event: "anthropic_usage" as const,
    callSite: params.callSite,
    model: params.model,
    inputTokens: params.usage.input_tokens,
    outputTokens: params.usage.output_tokens,
    cacheCreationInputTokens: params.usage.cache_creation_input_tokens,
    cacheReadInputTokens: params.usage.cache_read_input_tokens,
    webSearchRequests: params.usage.server_tool_use?.web_search_requests ?? 0,
    ...(params.bodyCharacterCount !== undefined ? { bodyCharacterCount: params.bodyCharacterCount } : {}),
    ...(params.retailer != null ? { retailer: params.retailer } : {}),
    ...(params.emailId != null ? { emailId: params.emailId } : {}),
  };
  console.log(JSON.stringify(event));
}
