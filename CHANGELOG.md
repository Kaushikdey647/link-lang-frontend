# Changelog

## [Unreleased]

### Added — Vercel Analytics/Speed Insights + per-stage latency breakdown in UI
- Installed `@vercel/analytics` and `@vercel/speed-insights`, wired `<Analytics/>` and `<SpeedInsights/>` into `app/layout.tsx`.
- Split retrieval timing into its actual components instead of one opaque `retrieval_ms`: translate (Sarvam) and the Qdrant RRF query are now timed separately in `lib/server/retrieval.ts` and surfaced through `lib/server/rag.ts`'s latency object. Added STT timing (voice route) and language-ID timing (query route, when `lang` is auto-detected), with `total_ms` recomputed to include them.
- UI: the timing badge in `AnswerDisplay.tsx` is now a dropdown (clock icon) that expands into a labeled per-stage breakdown (STT, language detection, input guardrail, translate, Qdrant retrieval, generation, grounding guardrail, total) — only showing stages actually present in the response.
- Known limitation: if `retrieve()` throws (e.g. Qdrant unreachable), any partial timing computed before the throw (like a successful translate before a failed Qdrant call) is lost — only the outer `retrieval_ms` wrapper survives in that case.

### Fixed — Sarvam STT rejects MediaRecorder's codec-qualified MIME type
- `MediaRecorder` reports e.g. `audio/webm;codecs=opus` (Chrome/Firefox) or `audio/mp4;codecs=mp4a.40.2` (Safari), which survived unchanged through the whole pipeline (browser → `/api/voice` → Sarvam) since `Blob.type` was passed straight through as the multipart Content-Type. Sarvam's STT endpoint allow-lists base MIME types only (e.g. `audio/webm`) and 400s on the codec-qualified variant — confirmed against a real deployment.
- `transcribe()` (`lib/server/sarvam.ts`) now strips codec parameters and re-wraps the Blob with the base type before sending, and derives a matching filename extension instead of always hardcoding `recording.webm` regardless of actual content.

## [0.1.0] — Initial extraction from the link-lang monorepo

- Extracted from `link-lang`'s `frontend/` directory into its own repository (`git@github.com:Kaushikdey647/link-lang-frontend.git`) — the serving flow (RRF hybrid retrieval, Sarvam STT/translate/generation, the 4-stage RAG harness, guardrails) had been ported from FastAPI/Python to TypeScript in that monorepo (`lib/server/{qdrant,sarvam,retrieval,guardrails,rag}.ts`, `app/api/{query,voice,health}/route.ts`) before the split; ingestion stayed Python and remains in `link-lang`.
- Verified rather than assumed: `@qdrant/js-client-rest` supports both cloud inference (`{text, model}`) and the Query API's `prefetch`/`FusionQuery({fusion:"rrf"})`; Sarvam's REST contracts (STT, translate, language-ID, chat completions) were confirmed directly against `docs.sarvam.ai`.
- "Which collection is live" is resolved by querying Qdrant directly and cached in memory per warm instance (`lib/server/qdrant.ts::getLiveCollection()`), not read from a local registry file — this survives a serverless deploy (e.g. Vercel), unlike file-based state.
