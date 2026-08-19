import "server-only";
import {
  getQdrantClient,
  getLiveCollection,
  DENSE_INFERENCE_MODEL,
} from "./qdrant";

/**
 * Dense-only retrieval against qa_pair chunks embedded with
 * intfloat/multilingual-e5-small (Qdrant Cloud inference).
 *
 * Index time prefixes documents with "passage: " (pipeline/indexer.py::_e5_text).
 * Query time must prefix with "query: " — e5 is trained on that asymmetry.
 * No English pivot / BM25: the collection is vernacular dense-only.
 */

export interface RetrievedDoc {
  pageContent: string;
  metadata: Record<string, unknown>;
}

export interface RetrievalTiming {
  qdrantQueryMs: number;
}

export interface RetrievalResult {
  docs: RetrievedDoc[];
  timing: RetrievalTiming;
}

type CacheEntry = {
  expiresAt: number;
  result: RetrievalResult;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 200;
const retrievalCache = new Map<string, CacheEntry>();

function e5QueryText(query: string): string {
  return `query: ${query}`;
}

function cacheKey(query: string, lang: string, topK: number, chunkTypes: string[]): string {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
  return `${lang}::${topK}::${chunkTypes.slice().sort().join(",")}::${normalized}`;
}

function getCached(key: string): RetrievalResult | null {
  const hit = retrievalCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    retrievalCache.delete(key);
    return null;
  }
  return {
    docs: hit.result.docs,
    timing: { qdrantQueryMs: 0 },
  };
}

function setCached(key: string, result: RetrievalResult): void {
  if (retrievalCache.size >= MAX_CACHE_SIZE) {
    const oldest = retrievalCache.keys().next().value as string | undefined;
    if (oldest) retrievalCache.delete(oldest);
  }
  retrievalCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
}

function dedupe(hits: RetrievedDoc[], topK: number): RetrievedDoc[] {
  const seen = new Map<string, RetrievedDoc>();
  for (const doc of hits) {
    const pid = (doc.metadata.passage_id ?? doc.metadata.chunk_id) as string | undefined;
    if (pid && !seen.has(pid)) seen.set(pid, doc);
    if (seen.size >= topK) break;
  }
  return [...seen.values()];
}

function buildFilter(lang: string, chunkTypes: string[]) {
  return {
    must: [
      { key: "metadata.lang", match: { value: lang } },
      { key: "metadata.chunk_type", match: { any: chunkTypes } },
    ],
  };
}

export async function retrieve(
  query: string,
  lang: string,
  topK: number,
  chunkTypes: string[] = ["qa_pair"],
): Promise<RetrievalResult> {
  const key = cacheKey(query, lang, topK, chunkTypes);
  const cached = getCached(key);
  if (cached) return cached;

  const client = getQdrantClient();
  const collection = await getLiveCollection();
  const qfilter = buildFilter(lang, chunkTypes);

  const t0 = performance.now();
  const result = await client.query(collection, {
    query: { text: e5QueryText(query), model: DENSE_INFERENCE_MODEL },
    filter: qfilter,
    // Keep ANN candidate count tight to cut retrieval RTT.
    limit: topK,
    // Return only fields the prompt/citations actually use.
    with_payload: {
      include: ["page_content", "metadata"],
    },
  });
  const qdrantQueryMs = performance.now() - t0;

  const docs: RetrievedDoc[] = result.points.map((p) => {
    const payload = (p.payload ?? {}) as Record<string, unknown>;
    return {
      pageContent: (payload.page_content as string) ?? "",
      metadata: (payload.metadata as Record<string, unknown>) ?? {},
    };
  });

  const retrievalResult = { docs: dedupe(docs, topK), timing: { qdrantQueryMs } };
  setCached(key, retrievalResult);
  return retrievalResult;
}
