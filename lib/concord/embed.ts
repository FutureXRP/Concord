/**
 * Embedding provider. concord_chunks.embedding is vector(1024); the default
 * provider is Voyage AI (voyage-3, 1024 dims). Pluggable so ingest and
 * retrieval share one implementation.
 */

export interface Embedder {
  embed(texts: string[], inputType: "query" | "document"): Promise<number[][]>;
  dimensions: number;
}

class VoyageEmbedder implements Embedder {
  dimensions = 1024;

  async embed(texts: string[], inputType: "query" | "document"): Promise<number[][]> {
    const key = process.env.EMBEDDINGS_API_KEY;
    if (!key) throw new Error("EMBEDDINGS_API_KEY is not set");
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.EMBEDDINGS_MODEL ?? "voyage-3",
        input: texts,
        input_type: inputType,
      }),
    });
    if (!res.ok) {
      throw new Error(`Embeddings request failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return data.data.map((d) => d.embedding);
  }
}

let embedder: Embedder | null = null;

export function getEmbedder(): Embedder {
  if (!embedder) embedder = new VoyageEmbedder();
  return embedder;
}

/** Test seam. */
export function setEmbedder(e: Embedder): void {
  embedder = e;
}
