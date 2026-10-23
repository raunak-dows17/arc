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
import type { TextGenerationPort } from "../../domain/ports/llm.port.js";
import type { ModelSelection } from "../config/models.js";
import { parseJsonWithRepair } from "./decision.schema.js";

const noulSchema = z.object({
  type: z.literal("noul"),
  noul: z.number().min(0).max(1),
});

const choiceSchema = z.object({
  type: z.literal("choice"),
  choice: z.string().min(1),
  probabilities: z.record(z.string(), z.number()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const scoreSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  legend: z.array(z.string()).optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const answerSchema = z.union([noulSchema, choiceSchema, scoreSchema]);
const resultSchema = z.object({
  answers: z.record(z.string(), answerSchema),
});

/**
 * Provider-neutral classifier used for email triage and similar small
 * structured decisions. It works with any TextGenerationPort that can return
 * JSON, including Gemini and OpenAI-compatible providers.
 */
export class LlmDecisionModelAdapter implements DecisionModelPort {
  constructor(
    private readonly llm: TextGenerationPort,
    private readonly selection: ModelSelection,
  ) {}

  async ask(request: DecisionRequest): Promise<DecisionResult> {
    const prompt = buildPrompt(request);
    let text: string;
    let usage: { promptTokens: number; completionTokens: number };
    try {
      const result = await this.llm.generateText(prompt, {
        systemPrompt:
          "You are a precise classifier. Return one JSON object and no prose. Follow the requested answer types exactly.",
        provider: this.selection.provider,
        model: this.selection.model,
        json: true,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      text = result.text;
      usage = result.usage;
    } catch (error) {
      if (request.signal?.aborted) {
        throw error;
      }
      throw new DecisionModelError(
        `Decision model call failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = parseJsonWithRepair(text);
    } catch (error) {
      throw new DecisionModelError(
        `Decision model returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (
      typeof parsedJson !== "object" ||
      parsedJson === null ||
      Array.isArray(parsedJson)
    ) {
      throw new DecisionModelError(
        "Decision model returned invalid JSON: expected a JSON object.",
      );
    }
    const parsed = resultSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new DecisionModelError(
        `Decision model response did not match the expected answers: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ")}`,
      );
    }

    const answers: Record<string, DecisionAnswer> = {};
    for (const [name, answer] of Object.entries(parsed.data.answers)) {
      answers[name] = normalizeAnswer(answer);
    }

    return {
      model: `${this.selection.provider}/${this.selection.model}`,
      answers,
      usage: {
        inputTokens: usage.promptTokens,
        outputTokens: usage.completionTokens,
      },
    };
  }
}

function normalizeAnswer(
  answer: z.infer<typeof answerSchema>,
): DecisionAnswer {
  if (answer.type === "noul") {
    return { type: "noul", noul: answer.noul };
  }
  if (answer.type === "choice") {
    const probabilities =
      answer.probabilities && Object.keys(answer.probabilities).length > 0
        ? answer.probabilities
        : { [answer.choice]: 1 };
    return {
      type: "choice",
      choice: answer.choice,
      probabilities,
      confidence:
        answer.confidence ??
        Math.max(0, ...Object.values(probabilities)),
    };
  }
  return {
    type: "score",
    score: answer.score,
    ...(answer.legend ? { legend: answer.legend } : {}),
    ...(answer.probabilities ? { probabilities: answer.probabilities } : {}),
    ...(answer.confidence !== undefined
      ? { confidence: answer.confidence }
      : {}),
  };
}

function buildPrompt(request: DecisionRequest): string {
  return [
    "Classify the state using every question below.",
    "Return exactly this shape:",
    '{"answers":{"<question_name>":{...}}}',
    "",
    "Answer shapes:",
    '- noul: {"type":"noul","noul":0.0} where noul is the probability that the answer is true.',
    '- choice: {"type":"choice","choice":"option","probabilities":{"option":1.0},"confidence":0.0}',
    '- score: {"type":"score","score":0.0,"confidence":0.0}',
    "",
    "Use only option names from the question criteria. Do not include Markdown.",
    "",
    "State:",
    typeof request.state === "string"
      ? request.state
      : JSON.stringify(request.state, null, 2),
    "",
    "Questions:",
    JSON.stringify(request.questions, null, 2),
  ].join("\n");
}
