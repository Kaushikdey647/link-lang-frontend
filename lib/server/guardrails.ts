import "server-only";

/**
 * Port of pipeline/guardrails.py — no embedding calls (matches the Python
 * rewrite: grounding is lexical token-overlap). The input safety/relevance
 * check is no longer a separate stage here — it's folded into the generation
 * system prompt (see lib/server/rag.ts's REFUSAL_PREFIX).
 */

export interface GuardrailResult {
  passed: boolean;
  reason: string;
}

// Fraction of an answer sentence's content words that must appear somewhere
// in the retrieved passages for that sentence to count as grounded.
const GROUNDING_OVERLAP_THRESHOLD = 0.35;
const MIN_WORD_LEN = 3;

// Unicode-letter runs — works across Indic scripts. Native `u`-flag property
// escape, a more direct equivalent of Python's `[^\W\d_]` than a hand-rolled port.
const WORD_RE = /\p{L}+/gu;

function contentWords(text: string): Set<string> {
  const words = text.match(WORD_RE) ?? [];
  return new Set(words.map((w) => w.toLowerCase()).filter((w) => w.length >= MIN_WORD_LEN));
}

/** Lexical token-overlap grounding check (no embedding call). */
export function checkGrounding(answer: string, passageTexts: string[]): GuardrailResult {
  if (!answer.trim() || passageTexts.length === 0) {
    return { passed: false, reason: "Empty answer or no passages." };
  }

  const sentences = answer
    .split(/(?<=[.!?।॥])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 3);
  if (sentences.length === 0) {
    return { passed: true, reason: "" };
  }

  const contextWords = new Set<string>();
  for (const text of passageTexts) {
    for (const w of contentWords(text)) contextWords.add(w);
  }

  let ungrounded = 0;
  for (const sentence of sentences) {
    const sWords = contentWords(sentence);
    if (sWords.size === 0) continue;
    let overlap = 0;
    for (const w of sWords) if (contextWords.has(w)) overlap++;
    if (overlap / sWords.size < GROUNDING_OVERLAP_THRESHOLD) ungrounded++;
  }

  const ungroundedRatio = ungrounded / sentences.length;
  if (ungroundedRatio > 0.5) {
    return {
      passed: false,
      reason: `${ungrounded}/${sentences.length} answer sentences not grounded in retrieved passages.`,
    };
  }
  return { passed: true, reason: "" };
}
