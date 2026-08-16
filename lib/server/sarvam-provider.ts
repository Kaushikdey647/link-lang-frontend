import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * AI SDK provider for Sarvam's OpenAI-compatible chat-completions endpoint.
 * `transformRequestBody` forces `reasoning_effort: null` on every request —
 * user-confirmed this disables Sarvam's reasoning step (the largest single
 * latency contributor, ~7.9s of the ~11.6s end-to-end budget).
 */
const sarvam = createOpenAICompatible({
  name: "sarvam",
  baseURL: "https://api.sarvam.ai/v1",
  headers: { Authorization: `Bearer ${process.env.SARVAM_API_KEY || ""}` },
  transformRequestBody: (body: Record<string, unknown>) => ({
    ...body,
    reasoning_effort: null,
  }),
});

export const sarvamChatModel = sarvam.chatModel("sarvam-105b");
