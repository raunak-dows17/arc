import { z } from "zod";
import {
  DecisionParseError,
  LlmError,
} from "../../domain/errors/agent.errors.js";
import type { LLMPort, LlmRequest } from "../../domain/ports/llm.port.js";
import type { AgentDecision } from "../../domain/value-objects/agent-decision.js";
import type { OllamaConfig } from "../config/env.js";
import { buildDecisionFormat, parseDecision } from "./decision.schema.js";

const chatResponseSchema = z.object({
  message: z.object({
    role: z.string().optional(),
    content: z.string(),
  }),
  done: z.boolean().optional(),
});

const tagsResponseSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      size: z.number().optional(),
    }),
  ),
});

export interface OllamaHealth {
  modelAvailable: boolean;
  warnings: string[];
}

const MAX_ATTEMPTS = 2;
const LARGE_MODEL_BYTES = 9 * 1024 ** 3;

export class OllamaLlmAdapter implements LLMPort {
  private readonly baseUrl: string;
  private thinkEnabled = true;

  constructor(private readonly config: OllamaConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  get model(): string {
    return this.config.model;
  }

  get url(): string {
    return this.baseUrl;
  }

  /**
   * Verifies that Ollama is reachable and the configured model is installed.
   */
  async checkHealth(): Promise<OllamaHealth> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new LlmError(
        `Could not reach Ollama at ${this.baseUrl}. Start it with "ollama serve".`,
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new LlmError(
        `Ollama health check failed with HTTP ${response.status}.`,
      );
    }

    const parsed = tagsResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new LlmError("Unexpected response from Ollama /api/tags.");
    }

    const warnings: string[] = [];
    const wanted = normalizeModelName(this.config.model);
    const model = parsed.data.models.find(
      (candidate) =>
        normalizeModelName(candidate.name) === wanted ||
        candidate.name === this.config.model ||
        candidate.name.split(":")[0] === this.config.model,
    );

    if (!model) {
      warnings.push(
        `Model "${this.config.model}" is not installed. Run: ollama pull ${this.config.model}`,
      );
      return { modelAvailable: false, warnings };
    }

    if (model.size !== undefined && model.size > LARGE_MODEL_BYTES) {
      warnings.push(
        `Model "${model.name}" is larger than 9 GB. With 16 GB RAM, qwen3:8b is the recommended maximum.`,
      );
    }

    return { modelAvailable: true, warnings };
  }

  async generateDecision(request: LlmRequest): Promise<AgentDecision> {
    const format = buildDecisionFormat(request.tools.map((tool) => tool.name));
    const baseMessages = [
      { role: "system" as const, content: request.systemPrompt },
      ...request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];

    let lastParseError: DecisionParseError | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const messages =
        lastParseError === null
          ? baseMessages
          : [
              ...baseMessages,
              {
                role: "user" as const,
                content: [
                  `Your previous response was rejected: ${lastParseError.message}`,
                  "Respond again with exactly one valid JSON object using only the keys thought, tool, and final.",
                ].join("\n"),
              },
            ];

      const payload = {
        model: this.config.model,
        messages,
        stream: false,
        format,
        ...(this.thinkEnabled ? { think: false } : {}),
        keep_alive: this.config.keepAlive,
        options: {
          temperature: this.config.temperature,
          top_p: this.config.topP,
          num_ctx: this.config.numCtx,
          repeat_penalty: 1.05,
        },
      };

      const data = await this.postChat(payload, request.signal);

      try {
        return parseDecision(data.message.content);
      } catch (error) {
        if (error instanceof DecisionParseError) {
          lastParseError = error;
          continue;
        }
        throw error;
      }
    }

    throw new LlmError(
      `The model did not return a valid decision after ${MAX_ATTEMPTS} attempts. Last error: ${lastParseError?.message ?? "unknown"}`,
    );
  }

  private async postChat(
    payload: Record<string, unknown>,
    externalSignal?: AbortSignal,
  ): Promise<z.infer<typeof chatResponseSchema>> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const signal = externalSignal
      ? AbortSignal.any([externalSignal, timeout])
      : timeout;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (error) {
      if (externalSignal?.aborted) {
        throw error;
      }
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new LlmError(
          `Ollama request timed out after ${this.config.timeoutMs} ms.`,
        );
      }
      throw new LlmError(
        `Could not reach Ollama at ${this.baseUrl}. Start it with "ollama serve".`,
        { cause: error },
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 404) {
        throw new LlmError(
          `Ollama model "${this.config.model}" was not found. Run: ollama pull ${this.config.model}`,
        );
      }
      throw new LlmError(
        `Ollama returned HTTP ${response.status}: ${detail.slice(0, 400)}`,
      );
    }

    const parsed = chatResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new LlmError("Unexpected response shape from Ollama /api/chat.");
    }

    return parsed.data;
  }
}

function normalizeModelName(name: string): string {
  return name.includes(":") ? name : `${name}:latest`;
}
