import assert from "node:assert/strict";
import { test } from "node:test";
import { CHUNK_TARGET_CHARS } from "../src/lib/rag-config";
import { chunkText } from "../src/lib/text-chunking";

test("normalizes whitespace and keeps a short FAQ as one chunk", () => {
  const [chunk] = chunkText("  Hours?\r\n\r\n  Open weekdays.  ");

  assert.ok(chunk);
  assert.equal(chunk.index, 0);
  assert.equal(chunk.content, "Hours?\n\nOpen weekdays.");
  assert.equal(chunk.estimatedTokens, Math.ceil(chunk.content.length / 4));
});

test("splits long text near the target size and repeats an overlap", () => {
  const longParagraph = "alpha ".repeat(900);
  const nextParagraph = "beta ".repeat(200);
  const chunks = chunkText(`${longParagraph}\n\n${nextParagraph}`);

  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((chunk) => chunk.content.length <= CHUNK_TARGET_CHARS));
  assert.ok(chunks[1].content.startsWith(chunks[0].content.slice(-480).trim()));
  assert.ok(chunks[2].content.startsWith(chunks[1].content.slice(-480).trim()));
  assert.deepEqual(
    chunks.map((chunk) => chunk.index),
    [0, 1, 2],
  );
});

test("returns no chunks for empty or whitespace-only input", () => {
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText(" \n \t "), []);
});
