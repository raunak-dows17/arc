import type {
  DecisionModelPort,
  DecisionRequest,
  DecisionResult,
} from "../../domain/ports/decision-model.port.js";
import type {
  LLMPort,
  LlmDecisionResult,
  LlmRequest,
  TextGenerationOptions,
  TextGenerationPort,
  TextGenerationResult,
} from "../../domain/ports/llm.port.js";
import { DecisionModelError } from "../../domain/errors/agent.errors.js";

/**
 * Free tiers and local models both have tight concurrency budgets. This
 * decorator funnels every model call through a single promise chain so the
 * parent turn, sub-agents, and the decision model never infer at once.
 */
export class SerializedLlmAdapter
  implements LLMPort, TextGenerationPort, DecisionModelPort
{
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly inner: LLMPort & TextGenerationPort,
    private readonly decisionModel?: DecisionModelPort,
  ) {}

  generateDecision(request: LlmRequest): Promise<LlmDecisionResult> {
    return this.enqueue(() => {
      request.signal?.throwIfAborted();
      return this.inner.generateDecision(request);
    });
  }

  generateText(
    prompt: string,
    options?: TextGenerationOptions,
  ): Promise<TextGenerationResult> {
    return this.enqueue(() => {
      options?.signal?.throwIfAborted();
      return this.inner.generateText(prompt, options);
    });
  }

  ask(request: DecisionRequest): Promise<DecisionResult> {
    return this.enqueue(() => {
      request.signal?.throwIfAborted();
      if (!this.decisionModel) {
        throw new DecisionModelError(
          "No decision model is configured. Run `arc setup` to select a triage model.",
        );
      }
      return this.decisionModel.ask(request);
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
