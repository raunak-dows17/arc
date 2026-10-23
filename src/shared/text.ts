export function truncateText(
  text: string,
  maxChars: number,
  note = "\n…[truncated]",
): string {
  if (text.length <= maxChars) {
    return text;
  }
  const removed = text.length - maxChars;
  return `${text.slice(0, maxChars)}${note.replace("[truncated]", `[truncated ${removed} chars]`)}`;
}

export function singleLine(text: string, maxChars: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
