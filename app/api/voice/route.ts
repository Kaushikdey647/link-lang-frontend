import { NextRequest, NextResponse } from "next/server";
import { transcribe } from "@/lib/server/sarvam";

/** Transcription-only endpoint. RAG generation now happens via the streaming
 * /api/query route — the client transcribes audio here first, then sends the
 * transcript through the same text path (via useChat's sendMessage), passing
 * the measured STT time along so the server can fold it into total latency. */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const audio = form.get("audio");

  if (!(audio instanceof Blob)) {
    return NextResponse.json({ detail: "audio field is required" }, { status: 400 });
  }

  try {
    const t0 = performance.now();
    const result = await transcribe(audio);
    const sttMs = performance.now() - t0;

    if (!result.transcript.trim()) {
      return NextResponse.json({ detail: "STT returned empty transcript." }, { status: 422 });
    }

    return NextResponse.json({ transcript: result.transcript, lang: result.lang, sttMs });
  } catch (e) {
    return NextResponse.json({ detail: `STT failed: ${e}` }, { status: 502 });
  }
}
