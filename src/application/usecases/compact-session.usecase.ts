import type { AgentSession } from "../../domain/entities/agent-session.js";
import type { TextGenerationPort } from "../../domain/ports/llm.port.js";
import { truncateText } from "../../shared/text.js";

export interface CompactSessionOptions {
  /** Compact when the working transcript exceeds this many characters. */
  thresholdChars: number;
  /** Always keep this many newest messages verbatim. */
  keepRecentMessages: number;
  maxSummaryChars?: number;
}

export interface CompactionResult {
  compacted: boolean;
  messagesSummarized: number;
}

/**
 * Replaces older transcript messages with a model-written summary. The full
 * transcript remains on disk; only the context view is compacted.
 */
export class CompactSessionUseCase {
  constructor(
    private readonly llm: TextGenerationPort,
    private readonly options: CompactSessionOptions,
  ) {}

  async maybeCompact(
    session: AgentSession,
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    return this.compact(session, false, signal);
  }

  async force(
    session: AgentSession,
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    return this.compact(session, true, signal);
  }

  private async compact(
    session: AgentSession,
    force: boolean,
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    const messages = session.messages;
    const working = session.workingMessages;
    const workingChars = working.reduce(
      (sum, message) => sum + message.content.length,
      0,
    );

    if (!force && workingChars < this.options.thresholdChars) {
      return { compacted: false, messagesSummarized: 0 };
    }

    const cut = Math.max(
      session.summary?.throughMessageCount ?? 0,
      messages.length - this.options.keepRecentMessages,
    );
    const alreadySummarized = session.summary?.throughMessageCount ?? 0;
    if (cut - alreadySummarized < 2) {
      return { compacted: false, messagesSummarized: 0 };
    }

    const transcript = messages
      .slice(alreadySummarized, cut)
      .map((message) => {
        const label =
          message.role === "tool"
            ? `tool:${message.toolName ?? "unknown"}`
            : message.role;
        return `${label}: ${truncateText(message.content, 2_000)}`;
      })
      .join("\n\n");

    const previous = session.summary
      ? `Existing summary:\n${session.summary.text}\n\n`
      : "";
    const prompt = [
      "Summarize the earlier part of this conversation for the model's future context.",
      "Keep durable user preferences, decisions, constraints, file paths, important tool outcomes, and open questions.",
      "Be factual and compact. Do not add advice. Use at most 250 words.",
      "",
      previous,
      "Conversation to summarize:",
      truncateText(transcript, 14_000),
    ].join("\n");

    signal?.throwIfAborted();

    try {
      const result = await this.llm.generateText(prompt, {
        systemPrompt:
          "You compress conversation history. Return only the summary text.",
        ...(signal ? { signal } : {}),
      });
      const summary = truncateText(
        result.text.trim(),
        this.options.maxSummaryChars ?? 4_000,
      );
      if (!summary) {
        return { compacted: false, messagesSummarized: 0 };
      }

      session.setSummary(summary, cut);
      session.recordUsage(result.usage);
      return { compacted: true, messagesSummarized: cut - alreadySummarized };
    } catch (error) {
      // A failed compaction is not a failed turn; normal history trimming still
      // keeps the request bounded.
      if (signal?.aborted) {
        throw error;
      }
      return { compacted: false, messagesSummarized: 0 };
    }
  }
}
