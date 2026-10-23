import { randomUUID } from "node:crypto";

/**
 * Sortable, filesystem-safe session id, e.g. 20261023T120000Z-1a2b3c4d.
 */
export function createSessionId(now: Date = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}
