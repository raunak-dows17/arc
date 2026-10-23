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
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          reasoning: z.string().nullable().optional(),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

const modelsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      context_length: z.number().optional(),
    }),
  ),
});

export interface OpenAiCompatibleConfig {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  jsonMode?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

export interface RemoteModelInfo {
  id: string;
  contextLength?: number;
}

/**
 * One adapter for Groq, OpenRouter, Cerebras, Mistral, GitHub Models, and any
 * other endpoint that implements the OpenAI chat-completions API.
 */
export class OpenAiCompatibleAdapter
  implements LLMPort, TextGenerationPort
{
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: OpenAiCompatibleConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    assertSafeBaseUrl(this.baseUrl);
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.maxTokens = config.maxTokens ?? 2_048;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async generateDecision(request: LlmRequest): Promise<LlmDecisionResult> {
    if (request.provider && request.provider !== this.config.providerId) {
      throw new LlmError(
        `OpenAI-compatible adapter for "${this.config.providerId}" cannot serve provider "${request.provider}".`,
      );
    }

    const model = request.model ?? "default";
    const baseMessages = [
      { role: "system" as const, content: request.systemPrompt },
      ...request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];

    let lastError: DecisionParseError | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const messages =
        lastError === null
          ? baseMessages
          : [
              ...baseMessages,
              {
                role: "user" as const,
                content: [
                  `Your previous response was rejected: ${lastError.message}`,
                  "Return exactly one JSON object with keys thought, tool, and final.",
                  "Keep thought to one short sentence or an empty string. Do not use Markdown fences.",
                ].join("\n"),
              },
            ];
      const data = await this.post(
        model,
        messages,
        true,
        request.signal,
      );
      const content = data.choices[0]?.message.content ?? "";
      try {
        return {
          decision: parseDecision(content),
          usage: usageFrom(data),
        };
      } catch (error) {
        if (error instanceof DecisionParseError) {
          lastError =
            data.choices[0]?.finish_reason === "length"
              ? new DecisionParseError(
                  `${error.message} (provider stopped at the output-token limit)`,
                )
              : error;
          continue;
        }
        throw error;
      }
    }

    throw new LlmError(
      `${this.config.providerId} did not return a valid decision after 2 attempts. Last error: ${lastError?.message ?? "unknown"}`,
    );
  }

  async generateText(
    prompt: string,
    options: TextGenerationOptions = {},
  ): Promise<TextGenerationResult> {
    if (options.provider && options.provider !== this.config.providerId) {
      throw new LlmError(
        `OpenAI-compatible adapter for "${this.config.providerId}" cannot serve provider "${options.provider}".`,
      );
    }
    const messages = [
      ...(options.systemPrompt
        ? [{ role: "system" as const, content: options.systemPrompt }]
        : []),
      { role: "user" as const, content: prompt },
    ];
    const data = await this.post(
      options.model ?? "default",
      messages,
      options.json === true,
      options.signal,
    );
    return {
      text: (data.choices[0]?.message.content ?? "").trim(),
      usage: usageFrom(data),
    };
  }

  async listModels(signal?: AbortSignal): Promise<RemoteModelInfo[]> {
    const response = await this.request(
      `${this.baseUrl}/models`,
      {
        method: "GET",
        headers: this.headers(),
      },
      signal,
    );
    if (!response.ok) {
      throw new LlmError(
        `${this.config.providerId} model list failed with HTTP ${response.status}.`,
      );
    }
    const parsed = modelsSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new LlmError(
        `${this.config.providerId} returned an unexpected model list.`,
      );
    }
    return parsed.data.data.map((model) => ({
      id: model.id,
      ...(model.context_length
        ? { contextLength: model.context_length }
        : {}),
    }));
  }

  private async post(
    model: string,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    json: boolean,
    signal?: AbortSignal,
  ): Promise<z.infer<typeof responseSchema>> {
    const payload: Record<string, unknown> = {
      model,
      messages,
      stream: false,
      temperature: 0.2,
      max_tokens: this.maxTokens,
      ...(json && this.config.jsonMode !== false
        ? { response_format: { type: "json_object" } }
        : {}),
    };

    let response = await this.request(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
      },
      signal,
    );

    // Some OpenAI-compatible providers reject response_format even though they
    // accept the rest of the protocol. Retry once without it.
    if (response.status === 400 && "response_format" in payload) {
      const body = await response.clone().text().catch(() => "");
      if (/response_format|json_object/i.test(body)) {
        delete payload.response_format;
        response = await this.request(
          `${this.baseUrl}/chat/completions`,
          {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(payload),
          },
          signal,
        );
      }
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new LlmError(
        `${this.config.providerId} returned HTTP ${response.status}: ${detail.slice(0, 500)}`,
      );
    }

    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new LlmError(
        `${this.config.providerId} returned an unexpected chat response.`,
      );
    }
    return parsed.data;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
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
        `${this.config.providerId} request timed out after ${this.timeoutMs} ms.`,
      );
    }
    throw new LlmError(
      `Could not reach ${this.config.providerId} at ${this.baseUrl}.`,
      { cause: lastError },
    );
  }
}

function usageFrom(data: z.infer<typeof responseSchema>): LlmUsage {
  return {
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalDurationMs: 0,
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
