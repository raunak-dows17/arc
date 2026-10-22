import type {
  AgentDecision,
  LLMPort,
  LLMRequirements,
} from "../../domain/ports/llm.port.js";
import { z } from "zod";
import { env } from "../../shared/config/env.js";
import { agentLogger } from "../../shared/logger/pino.logger.js";

const agentDecisionSchema = z
  .object({
    thought: z.string().min(1).optional(),
    finalAnswer: z
      .union([
        z.string().min(1),
        z.array(z.string().min(1)).min(1),
      ])
      .optional(),
    toolToCall: z
      .object({
        name: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (decision) =>
      (decision.finalAnswer !== undefined) !==
      (decision.toolToCall !== undefined),
    "The response must contain exactly one of finalAnswer or toolToCall.",
  );

const ollamaDecisionFormat = {
  type: "object",
  properties: {
    thought: { type: "string" },
    finalAnswer: {
      type: "string",
    },
    toolToCall: {
      type: "object",
      properties: {
        name: { type: "string" },
        arguments: { type: "object" },
      },
      required: ["name", "arguments"],
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const ollamaResponseSchema = z.object({
  message: z.object({
    content: z.string(),
  }),
});

export class OllamaLLMAdapter implements LLMPort {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor() {
    this.baseUrl = env.OLLAMA_BASE_URL;
    this.model = env.OLLAMA_MODEL;
  }

  async generateDecision(
    requirements: LLMRequirements,
  ): Promise<AgentDecision> {
    agentLogger.debug(
      "Dispatching payload stream to local Ollama interface service engine",
      {
        model: this.model,
        endpoint: `${this.baseUrl}/api/chat`,
      },
    );

    const defaultSystem =
      [
        "You are an autonomous AI agent.",
        "Return only the requested deliverable in finalAnswer; do not add a preamble, explanation, or extra formatting unless requested.",
        "Follow explicit output requirements exactly, including format, item count, length, and language.",
        "finalAnswer must be a plain string. Use toolToCall only when a tool is needed; otherwise answer directly.",
        "Return one top-level JSON object, never an array. Use exactly one of finalAnswer or toolToCall for a normal decision. thought is optional.",
      ].join(" ");
    const activeSystemPrompts = requirements.systemPrompt || defaultSystem;

    const formattedMessages = [
      {
        role: "system",
        content: activeSystemPrompts,
      },
      ...requirements.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        ...(msg.name && { name: msg.name }),
      })),
    ];

    try {
      let lastParseError: Error | undefined;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            messages:
              attempt === 0
                ? formattedMessages
                : [
                    ...formattedMessages,
                    {
                      role: "user",
                      content:
                        "Your previous response was invalid. Return exactly one JSON object with either a string finalAnswer or a toolToCall object, never both. If this is an evaluation, put exactly PASS or FAIL in finalAnswer. If the requested answer is a list, put its formatted text in finalAnswer.",
                    },
                  ],
            format: ollamaDecisionFormat,
            stream: false,
            options: {
              temperature: 0,
            },
          }),
        });

        if (!response.ok) {
          throw new Error(
            `Inference pipeline connection failed with status parameter code: ${response.status}`,
          );
        }

        const body = ollamaResponseSchema.parse(await response.json());
        try {
          const parsedContent: unknown = JSON.parse(body.message.content);
          const decisionContent = Array.isArray(parsedContent)
            ? parsedContent.length === 1
              ? parsedContent[0]
              : (() => {
                  throw new Error(
                    `Expected one decision object, received an array with ${parsedContent.length} items.`,
                  );
                })()
            : parsedContent;
          const data = agentDecisionSchema.parse(decisionContent);

          return {
            thought: data.thought ?? "Model returned a valid decision.",
            ...(data.finalAnswer !== undefined
              ? {
                  finalAnswer: Array.isArray(data.finalAnswer)
                    ? data.finalAnswer.join("\n")
                    : data.finalAnswer,
                }
              : {}),
            ...(data.toolToCall !== undefined
              ? { toolToCall: data.toolToCall }
              : {}),
          };
        } catch (error: unknown) {
          lastParseError =
            error instanceof Error ? error : new Error(String(error));
          if (attempt === 0) {
            agentLogger.warn(
              "Ollama response did not match the decision format; retrying once",
              { reason: lastParseError.message },
            );
          }
        }
      }

      const reason = lastParseError?.message ?? "Ollama returned no decision.";
      agentLogger.warn(
        "Ollama did not produce a valid decision after retry; returning a no-action result for application-level recovery",
        { reason },
      );
      return {
        thought: `Invalid model response; no action was taken. ${reason}`,
      };
    } catch (error: unknown) {
      const cause =
        error instanceof Error ? error : new Error(String(error));
      agentLogger.error(
        "Critical failure parsing local Ollama orchestration stream response payload",
        cause,
      );
      throw new Error(
        `Ollama returned an invalid response or the request failed: ${cause.message}`,
        { cause },
      );
    }
  }
}
