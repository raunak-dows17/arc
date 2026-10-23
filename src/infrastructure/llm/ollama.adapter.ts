import { z } from "zod";
import type { LlmUsage } from "../../domain/entities/agent-session.js";
import {
  DecisionParseError,
  LlmError,
} from "../../domain/errors/agent.errors.js";
import type {
  LLMPort,
  LlmDecisionResult,
  LlmRequest,
  TextGenerationPort,
  TextGenerationResult,
} from "../../domain/ports/llm.port.js";
import type { OllamaConfig } from "../config/env.js";
import { buildDecisionFormat, parseDecision } from "./decision.schema.js";

const chatResponseSchema = z.object({
  message: z.object({
    role: z.string().optional(),
    content: z.string(),
  }),
  done: z.boolean().optional(),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
  total_duration: z.number().nonnegative().optional(),
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
  checkedModels: string[];
  missingModels: string[];
  warnings: string[];
}

const MAX_ATTEMPTS = 2;
const LARGE_MODEL_BYTES = 9 * 1024 ** 3;

export class OllamaLlmAdapter implements LLMPort, TextGenerationPort {
  private readonly baseUrl: string;

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
   * Verifies that Ollama is reachable and the requested models are installed.
   * The main model is checked by default; callers can check the full routing
   * set with checkHealth([main, coding, research, decision]).
   */
  async checkHealth(
    models: readonly string[] = [this.config.model],
  ): Promise<OllamaHealth> {
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
    const checkedModels = [...new Set(models)];
    const missingModels: string[] = [];

    for (const wantedName of checkedModels) {
      const wanted = normalizeModelName(wantedName);
      const model = parsed.data.models.find(
        (candidate) =>
          normalizeModelName(candidate.name) === wanted ||
          candidate.name === wantedName ||
          candidate.name.split(":")[0] === wantedName,
      );

      if (!model) {
        missingModels.push(wantedName);
        warnings.push(
          `Model "${wantedName}" is not installed. Run: ollama pull ${wantedName}`,
        );
        continue;
      }

      if (model.size !== undefined && model.size > LARGE_MODEL_BYTES) {
        warnings.push(
          `Model "${model.name}" is larger than 9 GB. With 16 GB RAM, qwen3:8b is the recommended maximum.`,
        );
      }
    }

    return {
      modelAvailable: missingModels.length === 0,
      checkedModels,
      missingModels,
      warnings,
    };
  }

  async generateDecision(request: LlmRequest): Promise<LlmDecisionResult> {
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

      const data = await this.postChat(
        this.decisionPayload(
          messages,
          format,
          request.model ?? this.config.model,
        ),
        request.signal,
      );

      try {
        return {
          decision: parseDecision(data.message.content),
          usage: this.usageFrom(data),
        };
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

  async generateText(
    prompt: string,
    options: {
      systemPrompt?: string;
      model?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<TextGenerationResult> {
    const messages = [
      ...(options.systemPrompt
        ? [{ role: "system" as const, content: options.systemPrompt }]
        : []),
      { role: "user" as const, content: prompt },
    ];

    const data = await this.postChat(
      {
        model: options.model ?? this.config.model,
        messages,
        stream: false,
        think: false,
        keep_alive: this.config.keepAlive,
        options: {
          temperature: 0.2,
          top_p: this.config.topP,
          num_ctx: this.config.numCtx,
          num_predict: Math.min(512, this.config.numPredict),
          repeat_penalty: 1.05,
        },
      },
      options.signal,
    );

    return {
      text: data.message.content.trim(),
      usage: this.usageFrom(data),
    };
  }

  private decisionPayload(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    format: Record<string, unknown>,
    model: string,
  ): Record<string, unknown> {
    return {
      model,
      messages,
      stream: false,
      format,
      think: false,
      keep_alive: this.config.keepAlive,
      options: {
        temperature: this.config.temperature,
        top_p: this.config.topP,
        num_ctx: this.config.numCtx,
        num_predict: this.config.numPredict,
        repeat_penalty: 1.05,
      },
    };
  }

  private usageFrom(data: z.infer<typeof chatResponseSchema>): LlmUsage {
    return {
      promptTokens: data.prompt_eval_count ?? 0,
      completionTokens: data.eval_count ?? 0,
      totalDurationMs: Math.round((data.total_duration ?? 0) / 1_000_000),
    };
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
      const requestedModel = String(payload.model ?? this.config.model);
      if (response.status === 404) {
        throw new LlmError(
          `Ollama model "${requestedModel}" was not found. Run: ollama pull ${requestedModel}`,
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
