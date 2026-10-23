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
  TextGenerationOptions,
  TextGenerationPort,
  TextGenerationResult,
} from "../../domain/ports/llm.port.js";
import { parseDecision } from "./decision.schema.js";

const responseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(z.object({ text: z.string().optional() })).optional(),
          })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .min(1),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().int().nonnegative().optional(),
      candidatesTokenCount: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

const modelsSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      displayName: z.string().optional(),
      inputTokenLimit: z.number().optional(),
      supportedGenerationMethods: z.array(z.string()).optional(),
    }),
  ),
});

export interface GoogleGeminiConfig {
  providerId?: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

export interface GoogleModelInfo {
  id: string;
  displayName?: string;
  contextLength?: number;
}

/**
 * Native Gemini adapter. It uses Gemini's JSON response mode and response
 * schema instead of the OpenAI compatibility layer, which gives stronger
 * guarantees for the agent decision protocol.
 */
export class GoogleGeminiAdapter implements LLMPort, TextGenerationPort {
  private readonly providerId: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: GoogleGeminiConfig) {
    this.providerId = config.providerId ?? "google";
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    assertSafeBaseUrl(this.baseUrl);
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.maxTokens = config.maxTokens ?? 2_048;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async generateDecision(request: LlmRequest): Promise<LlmDecisionResult> {
    if (request.provider && request.provider !== this.providerId) {
      throw new LlmError(
        `Gemini adapter cannot serve provider "${request.provider}".`,
      );
    }
    const model = request.model ?? "gemini-2.5-flash";
    const toolNames = request.tools.map((tool) => tool.name);
    const schema = geminiDecisionSchema(toolNames);
    const contents: Array<{
      role: "user" | "model";
      parts: Array<{ text: string }>;
    }> = request.messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

    let lastError: DecisionParseError | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry =
        lastError === null
          ? ""
          : [
              `Your previous response was rejected: ${lastError.message}`,
              "Return exactly one JSON object with keys thought, tool, and final.",
              "Keep thought to one short sentence or an empty string.",
            ].join("\n");
      const data = await this.generate(
        model,
        request.systemPrompt,
        [
          ...contents,
          ...(retry
            ? [{ role: "user" as const, parts: [{ text: retry }] }]
            : []),
        ],
        {
          responseMimeType: "application/json",
          responseSchema: schema,
        },
        request.signal,
      );
      const text = candidateText(data);
      try {
        return {
          decision: parseDecision(text),
          usage: usageFrom(data),
        };
      } catch (error) {
        if (error instanceof DecisionParseError) {
          lastError =
            data.candidates[0]?.finishReason === "MAX_TOKENS"
              ? new DecisionParseError(
                  `${error.message} (Gemini stopped at the output-token limit)`,
                )
              : error;
          continue;
        }
        throw error;
      }
    }

    throw new LlmError(
      `Gemini did not return a valid decision after 2 attempts. Last error: ${lastError?.message ?? "unknown"}`,
    );
  }

  async generateText(
    prompt: string,
    options: TextGenerationOptions = {},
  ): Promise<TextGenerationResult> {
    if (options.provider && options.provider !== this.providerId) {
      throw new LlmError(
        `Gemini adapter cannot serve provider "${options.provider}".`,
      );
    }
    const data = await this.generate(
      options.model ?? "gemini-2.5-flash",
      options.systemPrompt ?? "",
      [{ role: "user", parts: [{ text: prompt }] }],
      options.json ? { responseMimeType: "application/json" } : {},
      options.signal,
    );
    return {
      text: candidateText(data).trim(),
      usage: usageFrom(data),
    };
  }

  async listModels(signal?: AbortSignal): Promise<GoogleModelInfo[]> {
    const response = await this.request(
      `${this.baseUrl}/models?pageSize=1000`,
      { method: "GET", headers: this.headers() },
      signal,
    );
    if (!response.ok) {
      throw new LlmError(
        `Google model list failed with HTTP ${response.status}.`,
      );
    }
    const parsed = modelsSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new LlmError("Google returned an unexpected model list.");
    }
    return parsed.data.models
      .filter(
        (model) =>
          !model.supportedGenerationMethods ||
          model.supportedGenerationMethods.includes("generateContent"),
      )
      .map((model) => ({
        id: model.name.replace(/^models\//, ""),
        ...(model.displayName ? { displayName: model.displayName } : {}),
        ...(model.inputTokenLimit
          ? { contextLength: model.inputTokenLimit }
          : {}),
      }));
  }

  private async generate(
    model: string,
    systemPrompt: string,
    contents: Array<{
      role: "user" | "model";
      parts: Array<{ text: string }>;
    }>,
    generationConfig: Record<string, unknown>,
    externalSignal?: AbortSignal,
  ): Promise<z.infer<typeof responseSchema>> {
    const normalizedModel = model.replace(/^models\//, "");
    const response = await this.request(
      `${this.baseUrl}/models/${encodeURIComponent(normalizedModel)}:generateContent`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          ...(systemPrompt
            ? { systemInstruction: { parts: [{ text: systemPrompt }] } }
            : {}),
          contents,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: this.maxTokens,
            ...generationConfig,
          },
        }),
      },
      externalSignal,
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new LlmError(
        `Google returned HTTP ${response.status}: ${detail.slice(0, 500)}`,
      );
    }

    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new LlmError("Google returned an unexpected chat response.");
    }
    return parsed.data;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-goog-api-key": this.config.apiKey,
    };
  }

  private async request(
    url: string,
    init: RequestInit,
    externalSignal?: AbortSignal,
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const signal = externalSignal
        ? AbortSignal.any([externalSignal, timeout])
        : timeout;
      try {
        const response = await this.fetchImpl(url, {
          ...init,
          redirect: "error",
          signal,
        });
        if (retryableStatus(response.status) && attempt < 2) {
          await sleep(600 * 2 ** attempt);
          continue;
        }
        return response;
      } catch (error) {
        if (externalSignal?.aborted) {
          throw error;
        }
        lastError = error;
        if (attempt < 2) {
          await sleep(600 * 2 ** attempt);
          continue;
        }
      }
    }

    if (
      lastError instanceof Error &&
      (lastError.name === "TimeoutError" || lastError.name === "AbortError")
    ) {
      throw new LlmError(
        `Google request timed out after ${this.timeoutMs} ms.`,
      );
    }
    throw new LlmError(`Could not reach Google at ${this.baseUrl}.`, {
      cause: lastError,
    });
  }
}

function candidateText(data: z.infer<typeof responseSchema>): string {
  return (
    data.candidates[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("") ?? ""
  );
}

function usageFrom(data: z.infer<typeof responseSchema>): LlmUsage {
  return {
    promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
    completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    totalDurationMs: 0,
  };
}

function geminiDecisionSchema(
  toolNames: readonly string[],
): Record<string, unknown> {
  const tool =
    toolNames.length > 0
      ? {
          type: "OBJECT",
          nullable: true,
          properties: {
            name: { type: "STRING", enum: [...toolNames] },
            args: { type: "OBJECT" },
          },
          required: ["name", "args"],
        }
      : { type: "NULL", nullable: true };
  return {
    type: "OBJECT",
    properties: {
      thought: { type: "STRING" },
      tool,
      final: { type: "STRING", nullable: true },
    },
    required: ["thought", "tool", "final"],
  };
}

function retryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertSafeBaseUrl(value: string): void {
  const url = new URL(value);
  const local =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new LlmError(
      `Provider base URL must use HTTPS (HTTP is allowed only for localhost): ${value}`,
    );
  }
}
