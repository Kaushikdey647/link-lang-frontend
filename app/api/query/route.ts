import { NextRequest } from "next/server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from "ai";
import { sarvamChatModel } from "@/lib/server/sarvam-provider";
import { prepareGeneration, finalizeGeneration } from "@/lib/server/rag";
import { identifyLanguage } from "@/lib/server/sarvam";

/** Streaming port of POST /query. Body: `{ messages, lang?, topK?, chunkTypes? }`
 * — the shape @ai-sdk/react's useChat sends (messages) plus our own custom
 * per-request fields (lang/topK/chunkTypes) passed via sendMessage's second arg. */

function lastUserText(messages: UIMessage[]): string {
  const last = messages[messages.length - 1];
  return (last?.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function sumExcludingGeneration(latency: Record<string, number>): number {
  return Object.entries(latency)
    .filter(([key]) => key !== "generation_ms" && key !== "total_ms")
    .reduce((a, [, v]) => a + v, 0);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const messages: UIMessage[] = body?.messages ?? [];
  const query = lastUserText(messages).trim();

  if (!query) {
    return new Response(JSON.stringify({ detail: "query must not be empty" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const topK: number = body?.topK ?? 5;
  // Serving strategy is fixed to qa_pair retrieval (vernacular dense e5).
  // Ignore request-level overrides so callers cannot drift to legacy chunkers.
  const chunkTypes: string[] = ["qa_pair"];
  let lang: string | undefined = body?.lang;
  const latency: Record<string, number> = {};
  // Voice path times STT client-side (before this request even starts) and
  // passes it through so the server-computed total stays end-to-end accurate.
  if (typeof body?.sttMs === "number") latency.stt_ms = body.sttMs;

  try {
    if (!lang) {
      const t0 = performance.now();
      lang = await identifyLanguage(query);
      latency.lid_ms = performance.now() - t0;
    }

    const prepared = await prepareGeneration(query, { lang, topK, chunkTypes });
    Object.assign(latency, prepared.latency);

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        prepared.passages.forEach((p, i) => {
          writer.write({
            type: "data-passage",
            id: `passage-${i}`,
            data: {
              index: i,
              text: p.text,
              passageId: (p as Record<string, unknown>).passage_id as string | undefined,
              isSelected: Boolean((p as Record<string, unknown>).is_selected),
            },
          });
        });

        if (prepared.docs.length === 0) {
          latency.total_ms = sumExcludingGeneration(latency);
          writer.write({
            type: "data-guardrails",
            id: "guardrails",
            data: {
              inputPassed: true,
              inputReason: "",
              groundingPassed: false,
              groundingReason: "No passages retrieved.",
            },
          });
          writer.write({ type: "data-latency", id: "latency", data: latency });
          writer.write({ type: "text-start", id: "answer" });
          writer.write({
            type: "text-delta",
            id: "answer",
            delta: "No relevant passages found in the corpus.",
          });
          writer.write({ type: "text-end", id: "answer" });
          return;
        }

        const genT0 = performance.now();
        const result = streamText({
          model: sarvamChatModel,
          system: prepared.system,
          prompt: prepared.prompt,
        });

        // Consume result.textStream ourselves (instead of merging
        // toUIMessageStream(result.stream)) so we control exactly when the
        // message finalizes: writing data-guardrails/data-latency AFTER a
        // model-level "finish" chunk has already gone out means the client
        // (useChat) treats the message as already complete and drops them —
        // this is what caused the answer text and latency dropdown to
        // silently vanish. Writing everything before `execute()` resolves
        // guarantees it lands inside the same message.
        writer.write({ type: "text-start", id: "answer" });
        let text = "";
        try {
          for await (const delta of result.textStream) {
            text += delta;
            writer.write({ type: "text-delta", id: "answer", delta });
          }
        } catch (e) {
          writer.write({
            type: "text-delta",
            id: "answer",
            delta: `\n\n(Generation failed: ${e})`,
          });
        }
        writer.write({ type: "text-end", id: "answer" });

        latency.generation_ms = performance.now() - genT0;
        const groundT0 = performance.now();
        const finalized = finalizeGeneration(text, prepared.docs);
        latency.grounding_guardrail_ms = performance.now() - groundT0;
        latency.total_ms = sumExcludingGeneration(latency);

        writer.write({
          type: "data-guardrails",
          id: "guardrails",
          data: {
            inputPassed: finalized.inputGuardrail.passed,
            inputReason: finalized.inputGuardrail.reason,
            groundingPassed: finalized.groundingGuardrail.passed,
            groundingReason: finalized.groundingGuardrail.reason,
          },
        });
        writer.write({ type: "data-latency", id: "latency", data: latency });
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (e) {
    return new Response(JSON.stringify({ detail: `Query pipeline unavailable: ${e}` }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}
