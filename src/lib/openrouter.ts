// Minimal OpenRouter chat-completions client, server-only. Mirrors the call the
// genaebot agent brain makes (same endpoint, auth header, and Referer/Title
// headers) so the two stay recognizably the same integration. Kept deliberately
// small: callers that need structured output pass response_format themselves.
import { config } from "@/src/config";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Reasoning models (e.g. deepseek-v4-pro) can be slow even with reasoning off.
const REQUEST_TIMEOUT_MS = 30_000;
// One extra attempt so a transient blip doesn't end the AI interview for good.
const MAX_ATTEMPTS = 2;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

// True only when a key is present. The interview route checks this first and
// serves the scripted fallback when it is false, so we never make a doomed call.
export function openRouterConfigured(): boolean {
  return Boolean(config.openRouterApiKey);
}

type ChatOptions = {
  temperature?: number;
  maxTokens?: number;
  // When true, ask OpenRouter to constrain the reply to a single JSON object.
  json?: boolean;
};

async function chatOnce(messages: ChatMessage[], options: ChatOptions): Promise<string> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      "Content-Type": "application/json",
      // OpenRouter uses these for attribution/rankings; harmless if unset.
      "HTTP-Referer": config.publicBaseUrl,
      "X-Title": "Genaie CV Interview",
    },
    body: JSON.stringify({
      model: config.openRouterModel,
      messages,
      temperature: options.temperature ?? 0.3,
      // Generous ceiling so the full running-CV JSON + reply never truncates as
      // the CV grows over the interview.
      max_tokens: options.maxTokens ?? 1500,
      // This is a short structured-extraction task, not a reasoning one. Turning
      // reasoning off keeps deepseek-v4-pro (and similar) from spending the whole
      // token budget on hidden reasoning and returning a truncated/empty answer —
      // which is what silently collapsed the interview to its scripted fallback.
      reasoning: { enabled: false },
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenRouter request failed with ${response.status}: ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenRouter returned an empty completion.");
  }
  return content;
}

// Sends one chat completion and returns the assistant message text. Retries once
// on any failure (timeout, non-2xx, empty). Throws on a missing key or after the
// final attempt — the interview route turns any throw into its scripted fallback,
// so failures never surface to the user as a hard error mid-conversation.
export async function openRouterChat(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  if (!config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await chatOnce(messages, options);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OpenRouter request failed.");
}
