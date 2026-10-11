import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/db";
import {
  buildGroundedInstructions,
  CHAT_FALLBACK,
  CHAT_MODEL,
  generateChatAnswer,
  isFallbackAnswer,
} from "@/lib/ai/chat-provider";
import { embedTexts } from "@/lib/ai/embed-provider";
import { retrieveChunks } from "@/lib/ai/retrieval-provider";
import { RETRIEVAL_THRESHOLD } from "@/lib/rag-config";

type GoldenCase = {
  id: string;
  question: string;
  expectedEvidence: string | null;
  expectFallback: boolean;
};

type EvaluatedCase = {
  id: string;
  question: string;
  expectFallback: boolean;
  topSimilarity: number | null;
  usedChunkCount: number;
  retrievalHit: boolean | null;
  fallbackCorrect: boolean | null;
  answerCorrect: boolean | null;
  answer?: string;
};

function hasValidCitation(answer: string, contextCount: number) {
  return [...answer.matchAll(/\[(\d+)\]/g)].some((match) => {
    const reference = Number(match[1]);
    return reference >= 1 && reference <= contextCount;
  });
}

async function main() {
  const chatbotId = process.env.CHATBOT_ID;
  if (!chatbotId) throw new Error("Set CHATBOT_ID to the assistant you want to evaluate.");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(chatbotId)
  ) {
    throw new Error("CHATBOT_ID must be a UUID.");
  }

  const goldenSet = JSON.parse(
    await readFile(join(process.cwd(), "eval", "golden-set.v1.json"), "utf8"),
  ) as GoldenCase[];
  const includeAnswers = process.argv.includes("--answers");
  const saveRun = process.argv.includes("--save");
  const { embeddings } = await embedTexts(goldenSet.map((item) => item.question));
  const evaluated: EvaluatedCase[] = [];

  for (let index = 0; index < goldenSet.length; index += 1) {
    const item = goldenSet[index];
    const retrieved = await retrieveChunks(chatbotId, embeddings[index]);
    const used = retrieved
      .map((chunk) => ({ ...chunk, similarity: Number(chunk.similarity) }))
      .filter((chunk) => chunk.similarity >= RETRIEVAL_THRESHOLD);
    const retrievalHit = item.expectFallback
      ? null
      : used.some((chunk) =>
          chunk.content.toLowerCase().includes(item.expectedEvidence?.toLowerCase() ?? ""),
        );
    const thresholdFallback = used.length === 0;
    let answer: string | undefined;
    let fallbackCorrect: boolean | null = null;
    let answerCorrect: boolean | null = null;

    if (includeAnswers) {
      answer = thresholdFallback
        ? CHAT_FALLBACK
        : await generateChatAnswer({
            instructions: buildGroundedInstructions(used),
            history: [],
            question: item.question,
          });
      const modelFallback = thresholdFallback || isFallbackAnswer(answer);
      fallbackCorrect = item.expectFallback ? modelFallback : !modelFallback;
      answerCorrect = item.expectFallback
        ? modelFallback
        : !modelFallback &&
          answer.toLowerCase().includes(item.expectedEvidence?.toLowerCase() ?? "") &&
          hasValidCitation(answer, used.length);
    }

    evaluated.push({
      id: item.id,
      question: item.question,
      expectFallback: item.expectFallback,
      topSimilarity: retrieved.length ? Number(retrieved[0].similarity) : null,
      usedChunkCount: used.length,
      retrievalHit,
      fallbackCorrect,
      answerCorrect,
      ...(answer ? { answer } : {}),
    });
  }

  const answerable = evaluated.filter((item) => !item.expectFallback);
  const unanswered = evaluated.filter((item) => item.expectFallback);
  const retrievalHits = answerable.filter((item) => item.retrievalHit).length;
  const report = {
    createdAt: new Date().toISOString(),
    chatbotId,
    model: includeAnswers ? CHAT_MODEL : null,
    mode: includeAnswers ? "retrieval-and-answer" : "retrieval-only",
    threshold: RETRIEVAL_THRESHOLD,
    counts: {
      total: evaluated.length,
      answerable: answerable.length,
      unanswered: unanswered.length,
    },
    metrics: {
      retrievalHitRate: answerable.length ? retrievalHits / answerable.length : 0,
      ...(includeAnswers
        ? {
            fallbackAccuracy:
              evaluated.filter((item) => item.fallbackCorrect).length / evaluated.length,
            answerAccuracy:
              evaluated.filter((item) => item.answerCorrect).length / evaluated.length,
          }
        : {}),
    },
    cases: evaluated,
  };

  if (saveRun) {
    const runDirectory = join(process.cwd(), "eval", "runs");
    await mkdir(runDirectory, { recursive: true });
    const filename = `rag-${new Date().toISOString().replaceAll(":", "-")}.json`;
    await writeFile(join(runDirectory, filename), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "RAG evaluation failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$client.end();
  });
