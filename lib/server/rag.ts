import "server-only";
import { retrieve, type RetrievedDoc } from "./retrieval";
import { checkGrounding, type GuardrailResult } from "./guardrails";
import { REFUSAL_PREFIX } from "@/lib/chat-types";

/**
 * Port of pipeline/rag.py::RAGChain, restructured for AI-SDK streaming
 * generation: this module handles retrieval + prompt prep (`prepareGeneration`)
 * and post-stream grounding/refusal parsing (`finalizeGeneration`). The
 * `streamText()` call itself lives in the route handler, which owns the
 * `createUIMessageStream` writer that generation needs to be wired into.
 *
 * The input guardrail is no longer a separate stage — it's folded into the
 * generation system prompt (a `REFUSED: <reason>` marker the model emits
 * instead of an answer), eliminating a full extra Sarvam round-trip.
 */

const LANG_NAMES: Record<string, string> = {
  hi: "Hindi", bn: "Bengali", gu: "Gujarati", kn: "Kannada",
  ml: "Malayalam", mr: "Marathi", ne: "Nepali", or: "Odia",
  pa: "Punjabi", sa: "Sanskrit", ta: "Tamil", te: "Telugu",
  ur: "Urdu", as: "Assamese",
};

const SYSTEM_TEMPLATE = (langName: string) =>
  `You are a helpful assistant that answers questions in ${langName}. ` +
  "You are given numbered context passages retrieved from a document corpus. " +
  "Answer the user's question using ONLY information present in the provided passages. " +
  `If the passages do not contain enough information to answer, say so clearly in ${langName}. ` +
  "Keep your answer concise and grounded in the context.\n\n" +
  "Before answering, check the user's question. If it is harmful, abusive, or completely " +
  `unrelated to information retrieval / question answering, respond with EXACTLY ` +
  `"${REFUSAL_PREFIX} <short reason>" and nothing else.`;

function formatContext(docs: RetrievedDoc[]): string {
  return docs
    .map((d, i) => {
      // english_query chunks embed the English question but return the
      // vernacular passage (parent_passage) as LLM context.
      const text = (d.metadata.parent_passage as string) || d.pageContent;
      return `[${i + 1}] ${text}`;
    })
    .join("\n\n");
}

export interface Passage {
  text: string;
  [key: string]: unknown;
}

function toPassages(docs: RetrievedDoc[]): Passage[] {
  return docs.map((d) => ({ text: d.pageContent, ...d.metadata }));
}

export interface PrepareOptions {
  lang?: string;
  topK?: number;
  chunkTypes?: string[];
}

export interface PreparedGeneration {
  system: string;
  prompt: string;
  docs: RetrievedDoc[];
  passages: Passage[];
  latency: Record<string, number>;
}

/** Retrieval + prompt prep. Passages empty => caller should skip generation
 * entirely and use the canned "no passages" response (matches prior behavior,
 * avoids paying for a Sarvam call with nothing to answer from). */
export async function prepareGeneration(
  query: string,
  opts: PrepareOptions = {},
): Promise<PreparedGeneration> {
  const lang = opts.lang ?? "hi";
  const topK = opts.topK ?? 5;
  const chunkTypes = opts.chunkTypes ?? ["english_query"];
  const langName = LANG_NAMES[lang] ?? lang;
  const system = SYSTEM_TEMPLATE(langName);

  const retrieval = await retrieve(query, lang, topK, chunkTypes);
  const latency: Record<string, number> = {
    translate_ms: retrieval.timing.translateMs,
    qdrant_query_ms: retrieval.timing.qdrantQueryMs,
  };
  const docs = retrieval.docs;

  if (docs.length === 0) {
    return { system, prompt: "", docs, passages: [], latency };
  }

  return {
    system,
    prompt: `Context passages:\n${formatContext(docs)}\n\nQuestion: ${query}`,
    docs,
    passages: toPassages(docs),
    latency,
  };
}

export interface FinalizedGeneration {
  inputGuardrail: GuardrailResult;
  groundingGuardrail: GuardrailResult;
}

/** Post-processes the fully-streamed generation text: parses the folded-in
 * refusal marker, otherwise runs the lexical grounding check. Called once the
 * client-visible stream has finished (grounding needs the complete answer —
 * it can't be checked against a partial stream).
 *
 * Note: this does NOT rewrite the already-streamed text — the raw model
 * output (including a `REFUSED:` marker, if present) is what the client
 * received token-by-token. The client is responsible for presenting a
 * refusal/ungrounded-answer notice based on these flags. */
export function finalizeGeneration(text: string, docs: RetrievedDoc[]): FinalizedGeneration {
  if (text.startsWith(REFUSAL_PREFIX)) {
    const reason = text.slice(REFUSAL_PREFIX.length).trim() || "Query flagged as unsafe or off-topic.";
    return {
      inputGuardrail: { passed: false, reason },
      groundingGuardrail: { passed: true, reason: "" },
    };
  }

  const passageTexts = docs.map((d) => (d.metadata.parent_passage as string) || d.pageContent);
  let groundingResult: GuardrailResult;
  try {
    groundingResult = checkGrounding(text, passageTexts);
  } catch (e) {
    groundingResult = { passed: false, reason: `Grounding check failed: ${e}` };
  }

  return { inputGuardrail: { passed: true, reason: "" }, groundingGuardrail: groundingResult };
}

/** Retrieval-only path — the sub-pipeline PROBLEM-STATEMENT.md's <200ms
 * latency target applies to. Skips guardrails/generation entirely. */
export async function retrieveOnly(
  query: string,
  lang = "hi",
  topK = 5,
  chunkTypes: string[] = ["english_query"],
): Promise<RetrievedDoc[]> {
  return (await retrieve(query, lang, topK, chunkTypes)).docs;
}
