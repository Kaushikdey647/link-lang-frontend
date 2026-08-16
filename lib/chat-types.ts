import type { UIMessage } from "ai";

// Shared between app/api/query/route.ts (server, writes these data parts) and
// the client (app/page.tsx, reads them off message.parts).

// Streamed generation text starting with this prefix means the model refused
// the query (the folded-in input-guardrail instruction) — see lib/server/rag.ts.
export const REFUSAL_PREFIX = "REFUSED:";

export interface PassageData {
  index: number;
  text: string;
  passageId?: string;
  isSelected: boolean;
}

export interface GuardrailsData {
  inputPassed: boolean;
  inputReason: string;
  groundingPassed: boolean;
  groundingReason: string;
}

export type LatencyData = Record<string, number>;

export type MyUIMessage = UIMessage<
  never,
  {
    passage: PassageData;
    guardrails: GuardrailsData;
    latency: LatencyData;
  }
>;
