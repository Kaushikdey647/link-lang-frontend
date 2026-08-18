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

function e5QueryText(query: string): string {
  return `query: ${query}`;
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
  const client = getQdrantClient();
  const collection = await getLiveCollection();
  const qfilter = buildFilter(lang, chunkTypes);

  const t0 = performance.now();
  const result = await client.query(collection, {
    query: { text: e5QueryText(query), model: DENSE_INFERENCE_MODEL },
    filter: qfilter,
    limit: topK * 4,
    with_payload: true,
  });
  const qdrantQueryMs = performance.now() - t0;

  const docs: RetrievedDoc[] = result.points.map((p) => {
    const payload = (p.payload ?? {}) as Record<string, unknown>;
    return {
      pageContent: (payload.page_content as string) ?? "",
      metadata: (payload.metadata as Record<string, unknown>) ?? {},
    };
  });

  return { docs: dedupe(docs, topK), timing: { qdrantQueryMs } };
}
