import type { LLMPort } from "../../domain/ports/llm.port.js";
import { PromptVO } from "../../domain/value_objects/prompt.vo.js";
import { agentLogger } from "../../shared/logger/pino.logger.js";

export interface ReflectionInput {
  taskDescription: string;
  executionOutput: string;
}

export class ReflectionOnTaskUsecase {
  constructor(private readonly llmProvider: LLMPort) {}

  async execute(
    input: ReflectionInput,
  ): Promise<{ isValid: boolean; critique: string }> {
    agentLogger.info(
      "Running self-reflection loop evaluation checking parameters",
    );

    const reflectionPrompt = new PromptVO({
      template:
        [
          "Evaluate whether the output fully and accurately satisfies the task, including all explicit formatting and quantity requirements.",
          'Return one JSON object with exactly one field: "finalAnswer".',
          'Set "finalAnswer" to exactly "PASS" if the output satisfies the task, or exactly "FAIL" if it does not.',
          "Do not include thought, tools, explanations, or any other fields.",
          "Task: {{task}}",
          "Output: {{output}}",
        ].join("\n"),
      variables: {
        task: input.taskDescription,
        output: input.executionOutput,
      },
    });

    const response = await this.llmProvider.generateDecision({
      messages: [{ role: "user", content: reflectionPrompt.toString() }],
    });

    const verdict = response.finalAnswer?.trim();
    if (verdict !== "PASS" && verdict !== "FAIL") {
      return {
        isValid: false,
        critique:
          response.thought ||
          `Reflection did not return PASS or FAIL (received ${JSON.stringify(verdict)}). Regenerate the proposed answer and satisfy the task exactly.`,
      };
    }

    return {
      isValid: verdict === "PASS",
      critique: response.thought,
    };
  }
}
