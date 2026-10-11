export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 100;

type EmbeddingResponse = {
  data: Array<{ index: number; embedding: number[] }>;
  usage?: { prompt_tokens?: number };
  error?: { message?: string };
};

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

async function requestBatch(inputs: string[]): Promise<EmbeddingResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new EmbeddingError("Add OPENAI_API_KEY to your local .env file to create embeddings.");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
      });
    } catch {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
        continue;
      }
      throw new EmbeddingError("Could not reach OpenAI. Check your internet connection and retry.");
    }

    if (response.ok) return (await response.json()) as EmbeddingResponse;

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      throw new EmbeddingError(
        "OpenAI rejected the API key. Check OPENAI_API_KEY in your .env file.",
      );
    }
    if (response.status === 429) {
      throw new EmbeddingError("OpenAI rate-limited this request. Wait a moment, then retry.");
    }

    throw new EmbeddingError(`OpenAI could not create embeddings (HTTP ${response.status}).`);
  }

  throw new EmbeddingError("OpenAI could not create embeddings. Please retry.");
}

/** All embedding requests go through this server-only provider boundary. */
export async function embedTexts(texts: string[]) {
  if (texts.length === 0) return { embeddings: [], totalTokens: 0 };

  const embeddings: number[][] = [];
  let totalTokens = 0;

  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    const result = await requestBatch(batch);

    if (result.data.length !== batch.length) {
      throw new EmbeddingError("OpenAI returned an incomplete embedding batch. Please retry.");
    }

    const ordered = [...result.data].sort((left, right) => left.index - right.index);
    for (const item of ordered) {
      if (item.embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new EmbeddingError("OpenAI returned an unexpected vector size.");
      }
      embeddings.push(item.embedding);
    }

    totalTokens += result.usage?.prompt_tokens ?? 0;
  }

  return { embeddings, totalTokens };
}
