"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ChevronUp, Clock } from "lucide-react";
import type { Passage, Latency } from "@/lib/api";

interface Props {
  transcript?: string;
  answer: string;
  passages: Passage[];
  totalMs?: number;
  latency?: Latency;
}

function fmtDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// Fixed display order — only stages actually present in `latency` render.
const STAGE_LABELS: Array<[key: keyof Latency, label: string]> = [
  ["stt_ms", "Speech-to-text"],
  ["lid_ms", "Language detection"],
  ["input_guardrail_ms", "Input guardrail"],
  ["translate_ms", "Translate (Sarvam)"],
  ["qdrant_query_ms", "Qdrant retrieval (RRF)"],
  ["generation_ms", "Generation (Sarvam-105B)"],
  ["grounding_guardrail_ms", "Grounding guardrail"],
];

export default function AnswerDisplay({ transcript, answer, passages, totalMs, latency }: Props) {
  const [showSources, setShowSources] = useState(false);
  const [showLatency, setShowLatency] = useState(false);

  const stages = STAGE_LABELS.filter(([key]) => latency?.[key] !== undefined);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="w-full max-w-xl mx-auto flex flex-col gap-4 px-2"
    >
      {/* Transcript */}
      {transcript && (
        <p className="text-white/40 text-sm text-center tracking-wide">
          &ldquo;{transcript}&rdquo;
        </p>
      )}

      {/* Answer */}
      <div className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm px-6 py-5">
        <p className="text-white/90 text-base leading-relaxed whitespace-pre-wrap">{answer}</p>
      </div>

      {/* Timing + sources + latency-breakdown toggles */}
      {(totalMs !== undefined || passages.length > 0) && (
        <div>
          <div className="flex items-center justify-center gap-3">
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
              className="overflow-hidden mt-3 rounded-xl border border-white/8 bg-white/3 px-4 py-3"
            >
              <div className="flex flex-col gap-1.5">
                {stages.map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between text-xs">
                    <span className="text-white/40">{label}</span>
                    <span className="text-white/60 font-mono">{fmtDuration(latency![key]!)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs pt-1.5 mt-1 border-t border-white/8">
                  <span className="text-white/50 font-medium">Total (server)</span>
                  <span className="text-white/70 font-mono font-medium">
                    {fmtDuration(latency?.total_ms ?? 0)}
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
              className="overflow-hidden mt-3 flex flex-col gap-2"
            >
              {passages.map((p, i) => (
                <div
                  key={p.passage_id + i}
                  className="rounded-xl border border-white/8 bg-white/3 px-4 py-3 text-xs text-white/50 leading-relaxed"
                >
                  <span className="text-white/25 font-mono mr-2">[{i + 1}]</span>
                  {p.is_selected && <span className="mr-2 text-white/40">★</span>}
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
