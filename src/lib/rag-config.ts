// Calibrated against the retrieval-only golden set; large FAQ chunks need a lower cutoff.
export const RETRIEVAL_THRESHOLD = 0.3;
// Only try spelling recovery when search found something plausibly related.
export const QUERY_REWRITE_MIN_SIMILARITY = 0.12;
export const RETRIEVAL_LIMIT = 5;
export const CHUNK_TARGET_CHARS = 3_600;
export const CHUNK_OVERLAP_CHARS = 480;
export const MAX_SOURCE_CHARS = 100_000;
