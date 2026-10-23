import type {
  LLMPort,
  LlmDecisionResult,
  LlmRequest,
  TextGenerationOptions,
  TextGenerationPort,
  TextGenerationResult,
} from "../../domain/ports/llm.port.js";
import type { ModelSelection } from "../config/models.js";
import { LlmError } from "../../domain/errors/agent.errors.js";

export type ProviderLlm = LLMPort & TextGenerationPort;

/**
 * Dispatches each call to the adapter for the selected provider. A request
 * without an explicit provider uses the default selection.
 */
export class RoutingLlmAdapter implements LLMPort, TextGenerationPort {
  constructor(
    private readonly providers: Readonly<Record<string, ProviderLlm>>,
    private readonly defaultSelection: ModelSelection,
  ) {}

  generateDecision(request: LlmRequest): Promise<LlmDecisionResult> {
    const selection = this.selection(request.provider, request.model);
    return this.provider(selection.provider).generateDecision({
      ...request,
      provider: selection.provider,
      model: selection.model,
    });
  }

  generateText(
    prompt: string,
    options: TextGenerationOptions = {},
  ): Promise<TextGenerationResult> {
    const selection = this.selection(options.provider, options.model);
    return this.provider(selection.provider).generateText(prompt, {
      ...options,
      provider: selection.provider,
      model: selection.model,
    });
  }

  hasProvider(id: string): boolean {
    return id in this.providers;
  }

  get providerIds(): string[] {
    return Object.keys(this.providers);
  }

  private selection(
    provider?: string,
    model?: string,
  ): { provider: string; model?: string } {
    const selectedProvider = provider ?? this.defaultSelection.provider;
    const selectedModel =
      model ??
      (selectedProvider === this.defaultSelection.provider
        ? this.defaultSelection.model
        : undefined);
    return {
      provider: selectedProvider,
      ...(selectedModel ? { model: selectedModel } : {}),
    };
  }

  private provider(id: string): ProviderLlm {
    const adapter = this.providers[id];
    if (!adapter) {
      throw new LlmError(
        `Provider "${id}" is not configured. Run "arc setup" or add it to ARC_HOME/models.json.`,
      );
    }
    return adapter;
  }
}

/**
 * Tries the primary provider, then each configured fallback. It never retries
 * a call that the user explicitly aborted.
 */
export class FallbackLlmAdapter implements LLMPort, TextGenerationPort {
  constructor(
    private readonly primary: ProviderLlm,
    private readonly fallbacks: readonly ModelSelection[],
  ) {}

  async generateDecision(request: LlmRequest): Promise<LlmDecisionResult> {
    try {
      return await this.primary.generateDecision(request);
    } catch (error) {
      if (request.signal?.aborted) {
        throw error;
      }
      return this.tryDecisionFallbacks(request, error);
    }
  }

  async generateText(
    prompt: string,
    options: TextGenerationOptions = {},
  ): Promise<TextGenerationResult> {
    try {
      return await this.primary.generateText(prompt, options);
    } catch (error) {
      if (options.signal?.aborted) {
        throw error;
      }
      return this.tryTextFallbacks(prompt, options, error);
    }
  }

  private async tryDecisionFallbacks(
    request: LlmRequest,
    primaryError: unknown,
  ): Promise<LlmDecisionResult> {
    let lastError = primaryError;
    for (const fallback of this.fallbacks) {
      try {
        return await this.primary.generateDecision({
          ...request,
          provider: fallback.provider,
          model: fallback.model,
        });
      } catch (error) {
        if (request.signal?.aborted) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError;
  }

  private async tryTextFallbacks(
    prompt: string,
    options: TextGenerationOptions,
    primaryError: unknown,
  ): Promise<TextGenerationResult> {
    let lastError = primaryError;
    for (const fallback of this.fallbacks) {
      try {
        return await this.primary.generateText(prompt, {
          ...options,
          provider: fallback.provider,
          model: fallback.model,
        });
      } catch (error) {
        if (options.signal?.aborted) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError;
  }
}
