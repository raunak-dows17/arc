import { z } from "zod";
import {
  DecisionModelError,
} from "../../domain/errors/agent.errors.js";
import type {
  DecisionAnswer,
  DecisionModelPort,
  DecisionRequest,
  DecisionResult,
} from "../../domain/ports/decision-model.port.js";

const noulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number().min(0).max(1),
});

const choiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string().min(1),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number().min(0).max(1),
});

const scoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  legend: z.array(z.string()).optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const answerSchema = z.discriminatedUnion("type", [
  noulAnswerSchema,
  choiceAnswerSchema,
  scoreAnswerSchema,
]);

const responseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), answerSchema),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});

export interface OllamaDecisionConfig {
  baseUrl: string;
  model: string;
  keepAlive: string;
  timeoutMs: number;
}

export interface OllamaDecisionOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Client for the System One decision endpoint (Ollama/Tev1, Colibrì/Laya,
 * Nimble, Clef). This adapter is deliberately separate from the tool-calling
 * chat adapter: decision models answer named questions and do not emit agent
 * actions.
 */
export class OllamaDecisionAdapter implements DecisionModelPort {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: OllamaDecisionConfig,
    options: OllamaDecisionOptions = {},
  ) {
    const base = config.baseUrl.replace(/\/+$/, "");
    this.baseUrl = base.endsWith("/v1") ? base : `${base}/v1`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async ask(request: DecisionRequest): Promise<DecisionResult> {
    request.signal?.throwIfAborted();

    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeout])
      : timeout;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/systemone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          state: request.state,
          questions: request.questions,
          keep_alive: this.config.keepAlive,
        }),
        signal,
      });
    } catch (error) {
      if (request.signal?.aborted) {
        throw error;
      }
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new DecisionModelError(
          `Decision model request timed out after ${this.config.timeoutMs} ms.`,
        );
      }
      throw new DecisionModelError(
        `Could not reach the decision model at ${this.baseUrl}.`,
        { cause: error },
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 404) {
        const hint = this.baseUrl.includes(":11434")
          ? ` Run: ollama pull ${this.config.model}`
          : " Install or pull the model for the configured local runtime.";
        throw new DecisionModelError(
          `Decision model "${this.config.model}" was not found.${hint}`,
        );
      }
      throw new DecisionModelError(
        `Decision model returned HTTP ${response.status}: ${detail.slice(0, 400)}`,
      );
    }

    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new DecisionModelError(
        "Unexpected response shape from the System One decision endpoint.",
      );
    }

    for (const question of Object.keys(request.questions)) {
      if (!(question in parsed.data.answers)) {
        throw new DecisionModelError(
          `Decision model did not answer the "${question}" question.`,
        );
      }
    }

    return {
      model: parsed.data.model,
      answers: parsed.data.answers as Record<string, DecisionAnswer>,
      usage: {
        inputTokens: parsed.data.usage?.input_tokens ?? 0,
        outputTokens: parsed.data.usage?.output_tokens ?? 0,
      },
    };
  }
}
