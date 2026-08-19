"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ChevronUp, Clock } from "lucide-react";
import { REFUSAL_PREFIX } from "@/lib/chat-types";
import type { PassageData, GuardrailsData, LatencyData } from "@/lib/chat-types";

interface Props {
  transcript?: string;
  answer: string;
  passages: PassageData[];
  guardrails?: GuardrailsData;
  latency?: LatencyData;
  streaming?: boolean;
}

function fmtDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// Fixed display order — only stages actually present in `latency` render.
// generation_ms is shown for information but excluded from "Total (server)":
// it streams to the client and is no longer counted as blocking latency.
const STAGE_LABELS: Array<[key: keyof LatencyData, label: string]> = [
  ["stt_ms", "Speech-to-text"],
  ["qdrant_query_ms", "Qdrant retrieval"],
  ["generation_ms", "Generation (Sarvam-105B, streamed)"],
  ["grounding_guardrail_ms", "Grounding guardrail"],
];

export default function AnswerDisplay({
  transcript,
  answer,
  passages,
  guardrails,
  latency,
  streaming,
}: Props) {
  const [showSources, setShowSources] = useState(false);
  const [showLatency, setShowLatency] = useState(false);

  const stages = STAGE_LABELS.filter(([key]) => latency?.[key] !== undefined);
  const totalMs = latency?.total_ms;

  const refused = answer.startsWith(REFUSAL_PREFIX);
  const displayAnswer = refused
    ? `I cannot answer this query. ${answer.slice(REFUSAL_PREFIX.length).trim()}`
    : answer;
  const showGroundingCaveat = !refused && guardrails && !guardrails.groundingPassed;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="mx-auto flex w-full max-w-xl flex-col gap-4 px-1 sm:px-2"
    >
      {/* Transcript */}
      {transcript && (
        <p className="text-center text-xs tracking-wide text-white/40 sm:text-sm">
          &ldquo;{transcript}&rdquo;
        </p>
      )}

      {/* Answer */}
      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 backdrop-blur-sm sm:px-6 sm:py-5">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/90 sm:text-base">
          {displayAnswer}
          {streaming && <span className="inline-block w-1.5 h-4 ml-0.5 bg-white/50 animate-pulse align-text-bottom" />}
        </p>
        {showGroundingCaveat && (
          <p className="mt-3 text-xs text-amber-400/70 border-t border-white/8 pt-2">
            This answer may not be fully grounded in the retrieved passages.
            {guardrails?.groundingReason ? ` (${guardrails.groundingReason})` : ""}
          </p>
        )}
      </div>

      {/* Timing + sources + latency-breakdown toggles */}
      {(totalMs !== undefined || passages.length > 0) && (
        <div>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
            {totalMs !== undefined && (
              stages.length > 0 ? (
                <button
                  onClick={() => setShowLatency((s) => !s)}
                  className="flex items-center gap-1 text-xs text-white/25 hover:text-white/60 font-mono tracking-wide transition-colors"
                >
                  <Clock size={11} />
                  {fmtDuration(totalMs)}
                  {showLatency ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
              ) : (
                <span className="text-xs text-white/25 font-mono tracking-wide">
                  {fmtDuration(totalMs)}
                </span>
              )
            )}
            {passages.length > 0 && (
              <button
                onClick={() => setShowSources((s) => !s)}
                className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors"
              >
                {showSources ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {passages.length} source{passages.length !== 1 ? "s" : ""}
              </button>
            )}
          </div>

          {showLatency && stages.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="mt-3 overflow-hidden rounded-xl border border-white/8 bg-white/3 px-3 py-3 sm:px-4"
            >
              <div className="flex flex-col gap-1.5">
                {stages.map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-white/40">{label}</span>
                    <span className="font-mono text-white/60">{fmtDuration(latency![key]!)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs pt-1.5 mt-1 border-t border-white/8">
                  <span className="text-white/50 font-medium">Total (server, excl. generation)</span>
                  <span className="text-white/70 font-mono font-medium">
                    {fmtDuration(totalMs ?? 0)}
                  </span>
                </div>
              </div>
            </motion.div>
          )}

          {showSources && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="mt-3 flex flex-col gap-2 overflow-hidden"
            >
              {passages.map((p) => (
                <div
                  key={p.passageId ?? p.index}
                  className="rounded-xl border border-white/8 bg-white/3 px-3 py-3 text-xs leading-relaxed text-white/50 sm:px-4"
                >
                  <span className="text-white/25 font-mono mr-2">[{p.index + 1}]</span>
                  {p.isSelected && <span className="mr-2 text-white/40">★</span>}
                  {p.text}
                </div>
              ))}
            </motion.div>
          )}
        </div>
      )}
    </motion.div>
  );
}
