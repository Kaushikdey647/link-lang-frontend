import { NextRequest, NextResponse } from "next/server";
import { trace } from "@opentelemetry/api";
import { transcribe } from "@/lib/server/sarvam";

/** Transcription-only endpoint. RAG generation now happens via the streaming
 * /api/query route — the client transcribes audio here first, then sends the
 * transcript through the same text path (via useChat's sendMessage), passing
 * the measured STT time along so the server can fold it into total latency. */
const tracer = trace.getTracer("link-lang.api.voice");

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const audio = form.get("audio");

  if (!(audio instanceof Blob)) {
    return NextResponse.json({ detail: "audio field is required" }, { status: 400 });
  }

  try {
    const { result, sttMs } = await tracer.startActiveSpan("rag.stt", async (span) => {
      const t0 = performance.now();
      try {
        const sttResult = await transcribe(audio);
        const elapsed = performance.now() - t0;
        span.setAttribute("rag.stt_ms", elapsed);
        span.setAttribute("rag.lang", sttResult.lang);
        span.setAttribute("rag.transcript_chars", (sttResult.transcript ?? "").length);
        return { result: sttResult, sttMs: elapsed };
      } catch (error) {
        span.recordException(error as Error);
        throw error;
      } finally {
        span.end();
      }
    });

    if (!result.transcript.trim()) {
      return NextResponse.json({ detail: "STT returned empty transcript." }, { status: 422 });
    }

    return NextResponse.json({ transcript: result.transcript, lang: result.lang, sttMs });
  } catch (e) {
    return NextResponse.json({ detail: `STT failed: ${e}` }, { status: 502 });
  }
}
