import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { AgentEvent } from "../../domain/events/agent-event.js";

const SENSITIVE_KEY = /(password|passwd|token|secret|api[-_]?key|authorization|cookie)/i;

/**
 * Append-only JSONL audit trail. Tool arguments and results are truncated and
 * sensitive keys are redacted before they reach disk.
 */
export class JsonlAuditLogger {
  constructor(private readonly filePath: string) {}

  async record(event: AgentEvent): Promise<void> {
    const line = `${JSON.stringify({
      ...event,
      data: redact(event.data),
    })}\n`;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, line, "utf8");
  }

  recordSafely(event: AgentEvent): void {
    void this.record(event).catch(() => {
      // Audit failures are reported nowhere by design; the turn must continue.
    });
  }
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return "[depth limit]";
  }
  if (typeof value === "string") {
    return value.length > 2_000 ? `${value.slice(0, 2_000)}…[truncated]` : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY.test(key)
        ? "[redacted]"
        : redact(entry, depth + 1);
    }
    return output;
  }
  return value;
}
