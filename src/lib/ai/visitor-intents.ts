const courtesyReplies = {
  greeting: "Hi! I can help with questions about this business. What would you like to know?",
  wellbeing: "I'm doing well, thanks for asking! What would you like to know about this business?",
  thanks: "You're welcome! Feel free to ask if you need anything else about this business.",
} as const;

/** Keep ordinary greetings out of document retrieval and avoid spending an LLM call on them. */
export function getCourtesyReply(question: string): string | null {
  const normalized = question
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/^(?:hi|hello|hey)(?: there)?$/.test(normalized)) return courtesyReplies.greeting;
  if (
    /^(?:how are you(?: doing)?|how is it going|hows it going|what is up|whats up)$/.test(
      normalized,
    )
  ) {
    return courtesyReplies.wellbeing;
  }
  if (/^(?:thanks|thank you|thx)$/.test(normalized)) return courtesyReplies.thanks;
  return null;
}
