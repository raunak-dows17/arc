/**
 * Small, dependency-free HTML helpers used by web fetch and email ingestion.
 * They are intentionally conservative: remove active content, preserve readable
 * text, and never execute or follow anything embedded in the markup.
 */

export function looksLikeHtml(body: string): boolean {
  return /<(?:!doctype|html|head|body|p|div|article)\b/i.test(
    body.slice(0, 1_000),
  );
}

export function extractHtmlTitle(
  body: string,
  contentType = "",
): string | null {
  const type = contentType.toLowerCase();
  if (type && !type.includes("html") && !type.includes("xml") && !looksLikeHtml(body)) {
    return null;
  }
  const match = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) {
    return null;
  }
  return decodeHtmlEntities(match[1]).replace(/\s+/g, " ").trim().slice(0, 300);
}

export function htmlToText(html: string): string {
  const withoutHidden = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ");

  const spaced = withoutHidden
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/(?:p|div|section|article|header|footer|main|aside|li|tr|h[1-6]|pre|blockquote|table|ul|ol|dl|dt|dd)>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, " ");

  return decodeHtmlEntities(spaced)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    mdash: "—",
    ndash: "–",
    hellip: "…",
    rsquo: "’",
    lsquo: "‘",
    ldquo: "“",
    rdquo: "”",
    copy: "©",
    reg: "®",
  };

  return text
    .replace(/&([a-z][a-z0-9]+);/gi, (match, name: string) => {
      return named[name.toLowerCase()] ?? match;
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return safeCodePoint(code, match);
    })
    .replace(/&#(\d+);/g, (match, decimal: string) => {
      const code = Number.parseInt(decimal, 10);
      return safeCodePoint(code, match);
    });
}

function safeCodePoint(code: number, fallback: string): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) {
    return fallback;
  }
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}
