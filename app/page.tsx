"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import MicButton from "@/components/MicButton";
import WaveformBars from "@/components/WaveformBars";
import AnswerDisplay from "@/components/AnswerDisplay";
import { useVoice } from "@/hooks/useVoice";
import { useHealth } from "@/hooks/useHealth";
import { transcribeVoice } from "@/lib/api";
import type { MyUIMessage, PassageData, GuardrailsData, LatencyData } from "@/lib/chat-types";

// ── State machine ────────────────────────────────────────────────────────────
//
//   idle → recording → processing (transcribing → streaming) → answered
//                                                             └→ error
//   (any) → recording  (tap mic again)
//
type UIState = "idle" | "recording" | "processing" | "answered" | "error";

const _fade = {
  initial:    { opacity: 0, y: 8 },
  animate:    { opacity: 1, y: 0 },
  exit:       { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
};

// Human-readable language names for the detected-lang badge
const LANG_NAMES: Record<string, string> = {
  hi: "हिंदी", bn: "বাংলা", ta: "தமிழ்", te: "తెలుగు",
  kn: "ಕನ್ನಡ", ml: "മലയാളം", mr: "मराठी", gu: "ગુજરાતી",
  pa: "ਪੰਜਾਬੀ", or: "ଓଡ଼ିଆ", ne: "नेपाली", ur: "اردو",
  as: "অসমীয়া", sa: "संस्कृतम्", en: "English",
};

function fmtTime(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function partsOfType<T>(message: MyUIMessage | undefined, type: string): T[] {
  if (!message) return [];
  return message.parts
    .filter((p) => p.type === type)
    .map((p) => (p as unknown as { data: T }).data);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const [uiState, setUiState] = useState<UIState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState<string | undefined>();
  const [detectedLang, setDetectedLang] = useState<string | undefined>();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { messages, sendMessage, status, error, setMessages } = useChat<MyUIMessage>({
    transport: new DefaultChatTransport({ api: "/api/query" }),
  });

  const assistantMessage = messages.find((m) => m.role === "assistant");
  const answerText = (assistantMessage?.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
  const passages = partsOfType<PassageData>(assistantMessage, "data-passage").sort(
    (a, b) => a.index - b.index,
  );
  const guardrails = partsOfType<GuardrailsData>(assistantMessage, "data-guardrails")[0];
  const latency = partsOfType<LatencyData>(assistantMessage, "data-latency")[0];

  // ── Drive uiState off useChat's status + local recording/transcribing state ─

  const [isTranscribing, setIsTranscribing] = useState(false);

  useEffect(() => {
    if (isTranscribing || status === "submitted" || status === "streaming") {
      setUiState("processing");
    } else if (status === "error" && error) {
      setErrorMsg(String(error.message ?? error));
      setUiState("error");
    } else if (status === "ready" && assistantMessage) {
      setUiState("answered");
    }
  }, [isTranscribing, status, error, assistantMessage]);

  // ── Voice result callback ─────────────────────────────────────────────────

  const handleVoiceResult = useCallback(
    async (blob: Blob) => {
      setMessages([]);
      setTranscript(undefined);
      setDetectedLang(undefined);
      setErrorMsg("");
      setIsTranscribing(true);
      try {
        const { transcript: t, lang, sttMs } = await transcribeVoice(blob);
        setTranscript(t);
        setDetectedLang(lang);
        setIsTranscribing(false);
        sendMessage({ text: t }, { body: { lang, sttMs } });
      } catch (e) {
        setErrorMsg(String(e));
        setIsTranscribing(false);
        setUiState("error");
      }
    },
    [sendMessage, setMessages],
  );

  const voice = useVoice(handleVoiceResult);

  // ── Recording timer ───────────────────────────────────────────────────────

  useEffect(() => {
    if (uiState === "recording") {
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (uiState !== "processing") setSeconds(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [uiState]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleToggle = useCallback(async () => {
    if (uiState === "recording") {
      voice.stop();   // → mr.onstop → handleVoiceResult → "processing"
    } else {
      setErrorMsg("");
      setUiState("recording");
      try {
        await voice.start();
      } catch {
        setErrorMsg("Microphone access denied. Allow mic access and try again.");
        setUiState("error");
      }
    }
  }, [uiState, voice]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const health       = useHealth();
  const isRecording  = uiState === "recording";
  const isProcessing = uiState === "processing";
  const isStreaming  = status === "streaming";
  const backendReady = health === "ready";

  return (
    <div className="relative flex flex-col min-h-dvh overflow-hidden bg-[#0d0d0d] text-white select-none">

      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[320px] w-[320px] rounded-full bg-white/[0.02] blur-3xl sm:h-[420px] sm:w-[420px] md:h-[500px] md:w-[500px]" />
      </div>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between px-4 pb-2 pt-6 sm:px-6 sm:pt-8">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-white/30 tracking-[0.2em] uppercase">Bhasha</span>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-white/70 tracking-tight">Voice AI</span>
            <span
              title={health === "ready" ? "Backend ready" : health === "checking" ? "Connecting…" : "Backend unreachable"}
              className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${
                health === "ready"     ? "bg-white/50" :
                health === "checking" ? "bg-white/20 animate-pulse" :
                                        "bg-red-500/60"
              }`}
            />
          </div>
        </div>

        {/* Detected language badge — shows after a voice answer */}
        <AnimatePresence>
          {detectedLang && (
            <motion.div
              key="lang-badge"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] tracking-wide text-white/30 sm:px-3 sm:text-xs"
            >
              {LANG_NAMES[detectedLang] ?? detectedLang}
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* ── Main — state-specific center content ────────────────────────────── */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-4 py-4 sm:gap-6 sm:px-6">
        <AnimatePresence mode="wait">

          {/* idle */}
          {uiState === "idle" && (
            <motion.div key="idle" {..._fade} className="flex flex-col items-center gap-3 px-2 text-center">
              <WaveformBars bars={11} active={false} className="mb-2" />
              <p className="text-xs tracking-wide text-white/25 sm:text-sm">
                Speak in any of 14 Indian languages
              </p>
            </motion.div>
          )}

          {/* recording — live transcript */}
          {uiState === "recording" && (
            <motion.div key="recording" {..._fade} className="flex w-full max-w-sm flex-col items-center gap-4 px-3 text-center sm:px-4">
              <AnimatePresence mode="wait">
                {voice.liveTranscript ? (
                  <motion.p key="words" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="text-sm leading-relaxed text-white/75 sm:text-base">
                    {voice.liveTranscript}
                  </motion.p>
                ) : (
                  <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 0.35 }}
                    className="text-xs tracking-widest sm:text-sm">
                    Listening…
                  </motion.p>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* processing (transcribing, before any streamed text has arrived) */}
          {uiState === "processing" && !answerText && (
            <motion.div key="processing" {..._fade} className="flex flex-col items-center gap-4">
              <WaveformBars bars={11} active={true} />
              <p className="text-white/40 text-sm tracking-widest">One moment…</p>
            </motion.div>
          )}

          {/* answered — also covers mid-stream once the first token arrives */}
          {(uiState === "answered" || (uiState === "processing" && answerText)) && (
            <motion.div key="answered" {..._fade} className="w-full">
              <AnswerDisplay
                transcript={transcript}
                answer={answerText}
                passages={passages}
                guardrails={guardrails}
                latency={latency}
                streaming={isStreaming}
              />
            </motion.div>
          )}

          {/* error */}
          {uiState === "error" && (
            <motion.div key="error" {..._fade}
              className="flex max-w-sm flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-center sm:px-6 sm:py-5">
              <p className="text-sm text-white/50">{errorMsg}</p>
              <p className="text-[11px] tracking-wide text-white/20 sm:text-xs">
                {backendReady ? "Tap the mic to try again" : "Waiting for backend…"}
              </p>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* ── Bottom controls ─────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:gap-4 sm:px-6 sm:pb-10">

        {/* Recording: timer + waveform */}
        <AnimatePresence>
          {isRecording && (
            <motion.div key="rec-chrome" {..._fade} className="flex flex-col items-center gap-2">
              <span className="text-xs text-white/35 font-mono tabular-nums tracking-widest">
                {fmtTime(seconds)}
              </span>
              <WaveformBars bars={15} active={true} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mic button — hidden only during processing */}
        {!isProcessing && (
          <div className="flex flex-col items-center gap-1">
            <MicButton
              isRecording={isRecording}
              onToggle={handleToggle}
              disabled={!backendReady && !isRecording}
            />
            {health === "unreachable" && !isRecording && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="text-xs text-red-400/60 tracking-wide">
                Backend offline
              </motion.p>
            )}
            {health === "checking" && !isRecording && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="text-xs text-white/25 tracking-wide animate-pulse">
                Connecting…
              </motion.p>
            )}
          </div>
        )}

        <p className="text-[11px] tracking-wide text-white/20 sm:text-xs">Voice-only mode (STT)</p>

      </div>
    </div>
  );
}
