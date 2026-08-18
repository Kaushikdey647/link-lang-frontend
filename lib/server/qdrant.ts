import "server-only";
import { QdrantClient } from "@qdrant/js-client-rest";

/**
 * Qdrant connection + live-collection resolution.
 *
 * Ports pipeline/indexer.py's QDRANT_URL/QDRANT_API_KEY constants and the
 * registry-based collection lookup — but the "which collection is live"
 * resolution is cached in-memory per warm serverless instance (a module
 * scoped variable) instead of persisted to a local registry.json file. That
 * file is per-machine, local-filesystem state; a serverless deploy's
 * filesystem doesn't survive across invocations, so this looks the
 * collection up once per warm instance and re-resolves on cold start.
 *
 * Ingestion (scripts/index.py, staying Python) is the only writer of data —
 * this module only ever reads.
 */

const QDRANT_URL = process.env.QDRANT_CLUSTER_ENDPOINT || "http://localhost:6333";
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

if (!process.env.QDRANT_EMBEDDING_MODEL) {
  throw new Error("QDRANT_EMBEDDING_MODEL is not set (see .env.local)");
}
if (!process.env.QDRANT_COLLECTION_NAME) {
  throw new Error("QDRANT_COLLECTION_NAME is not set (see .env.local)");
}

// Dense embedding model — exact Qdrant Cloud inference model registry
// identifier, casing matters. Serving is multilingual-e5-small + qa_pair
// (see pipeline/indexer.py::E5_SMALL_INFERENCE_MODEL).
export const DENSE_INFERENCE_MODEL = process.env.QDRANT_EMBEDDING_MODEL;

export const COLLECTION_NAME = process.env.QDRANT_COLLECTION_NAME;

let client: QdrantClient | null = null;

export function getQdrantClient(): QdrantClient {
  if (!client) {
    client = new QdrantClient({ url: QDRANT_URL, apiKey: QDRANT_API_KEY });
  }
  return client;
}

// Cached per warm instance — populated on first use, reset on cold start.
let cachedCollection: string | null = null;

/** Resolve + cache the live collection name. Throws if it doesn't exist or is empty. */
export async function getLiveCollection(): Promise<string> {
  if (cachedCollection) return cachedCollection;

  const client = getQdrantClient();
  const { collections } = await client.getCollections();
  const found = collections.some((c) => c.name === COLLECTION_NAME);
  if (!found) {
    throw new Error(
      `Collection "${COLLECTION_NAME}" not found in Qdrant — has it been indexed? See INDEXING.md.`,
    );
  }
  const countResult = await client.count(COLLECTION_NAME, { exact: false });
  if (countResult.count === 0) {
    throw new Error(`Collection "${COLLECTION_NAME}" exists but has no points.`);
  }
  cachedCollection = COLLECTION_NAME;
  return cachedCollection;
}

/** Non-throwing readiness check for /api/health. */
export async function isLive(): Promise<boolean> {
  try {
    await getLiveCollection();
    return true;
  } catch {
    return false;
  }
}
