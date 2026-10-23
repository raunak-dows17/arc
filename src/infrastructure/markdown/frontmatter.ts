import { parse as parseYaml } from "yaml";

export interface MarkdownDocument {
  data: Record<string, unknown>;
  body: string;
}

/**
 * Parses optional YAML frontmatter followed by a Markdown body.
 */
export function parseMarkdownDocument(text: string): MarkdownDocument {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { data: {}, body: normalized.trim() };
  }

  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    return { data: {}, body: normalized.trim() };
  }

  const rawFrontmatter = normalized.slice(4, end);
  const afterMarker = normalized.indexOf("\n", end + 1);
  const body = afterMarker === -1 ? "" : normalized.slice(afterMarker + 1);

  let parsed: unknown;
  try {
    parsed = parseYaml(rawFrontmatter);
  } catch (error) {
    throw new Error(
      `Invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (parsed !== null && typeof parsed !== "object") {
    throw new Error("YAML frontmatter must be a mapping.");
  }

  return {
    data: (parsed as Record<string, unknown> | null) ?? {},
    body: body.trim(),
  };
}

export function stringValue(
  data: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function booleanValue(
  data: Record<string, unknown>,
  keys: readonly string[],
): boolean | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "boolean") {
      return value;
    }
    if (value === "true" || value === "false") {
      return value === "true";
    }
  }
  return undefined;
}

export function numberValue(
  data: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

export function listValue(
  data: Record<string, unknown>,
  keys: readonly string[],
): "*" | string[] | undefined {
  for (const key of keys) {
    const value = data[key];
    if (value === "*") {
      return "*";
    }
    if (Array.isArray(value)) {
      const entries = value.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      );
      return entries.map((entry) => entry.trim());
    }
    if (typeof value === "string" && value.trim()) {
      if (value.trim() === "*") {
        return "*";
      }
      return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  }
  return undefined;
}
