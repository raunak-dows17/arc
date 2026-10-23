import type {
  LLMPort,
  LlmDecisionResult,
  LlmRequest,
  TextGenerationPort,
  TextGenerationResult,
} from "../../domain/ports/llm.port.js";

/**
 * Local models are memory-heavy and Ollama handles concurrent requests poorly
 * on a 16 GB machine. This decorator funnels every model call through a single
 * promise chain so the parent turn and any sub-agent never inference at once.
 */
export class SerializedLlmAdapter implements LLMPort, TextGenerationPort {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly inner: LLMPort & TextGenerationPort,
  ) {}

  generateDecision(request: LlmRequest): Promise<LlmDecisionResult> {
    return this.enqueue(() => {
      request.signal?.throwIfAborted();
      return this.inner.generateDecision(request);
    });
  }

  generateText(
    prompt: string,
    options?: { systemPrompt?: string; signal?: AbortSignal },
  ): Promise<TextGenerationResult> {
    return this.enqueue(() => {
      options?.signal?.throwIfAborted();
      return this.inner.generateText(prompt, options);
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
