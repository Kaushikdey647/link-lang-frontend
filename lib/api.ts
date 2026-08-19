// Same-origin now that the serving flow is Next.js API routes
// (frontend/app/api/*) instead of a separate FastAPI backend.
//
// /api/query and /api/voice moved to AI-SDK streaming responses (see
// app/page.tsx, which now uses @ai-sdk/react's useChat + lib/chat-types.ts).
// The types below are kept for components/PassageCitations.tsx and
// components/MessageBubble.tsx, which are unused elsewhere but still typecheck
// against this shape.

export interface Passage {
  passage_id: string;
  chunk_type: string;
  text: string;
  is_selected: boolean;
}

export interface Guardrails {
  input_passed: boolean;
  input_reason: string;
  grounding_passed: boolean;
  grounding_reason: string;
}

// Per-stage server latency (ms). stt_ms only present for /api/voice, lid_ms
// only present when language was auto-detected instead of passed explicitly.
export interface Latency {
  stt_ms?: number;
  lid_ms?: number;
  qdrant_query_ms?: number;
  generation_ms?: number;
  grounding_guardrail_ms?: number;
  total_ms?: number;
}

export interface TranscribeResult {
  transcript: string;
  lang: string;
  sttMs: number;
}

/** Transcribes audio via /api/voice (STT only — generation happens through
 * useChat's streaming /api/query path, see app/page.tsx). */
export async function transcribeVoice(audioBlob: Blob): Promise<TranscribeResult> {
  const form = new FormData();
  form.append("audio", audioBlob, "recording.webm");

  const res = await fetch("/api/voice", { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}
