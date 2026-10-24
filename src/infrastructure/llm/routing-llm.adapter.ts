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
import type { ProviderHealthRegistry } from "../models/provider-health.js";

export type ProviderLlm = LLMPort & TextGenerationPort;

/**
 * Dispatches each call to the adapter for the selected provider. A request
 * without an explicit provider uses the default selection.
 */
export class RoutingLlmAdapter implements LLMPort, TextGenerationPort {
  constructor(
    private readonly providers: Readonly<Record<string, ProviderLlm>>,
    private readonly defaultSelection: ModelSelection,
    private readonly health?: ProviderHealthRegistry,
  ) {}

  async generateDecision(request: LlmRequest): Promise<LlmDecisionResult> {
    const selection = this.selection(request.provider, request.model);
    const started = Date.now();
    try {
      const result = await this.provider(selection.provider).generateDecision({
        ...request,
        provider: selection.provider,
        model: selection.model,
      });
      this.health?.recordSuccess(
        selection.provider,
        selection.model ?? "default",
        Date.now() - started,
      );
      return result;
    } catch (error) {
      if (!request.signal?.aborted) {
        this.health?.recordFailure(
          selection.provider,
          selection.model ?? "default",
          error,
        );
      }
      throw error;
    }
  }

  async generateText(
    prompt: string,
    options: TextGenerationOptions = {},
  ): Promise<TextGenerationResult> {
    const selection = this.selection(options.provider, options.model);
    const started = Date.now();
    try {
      const result = await this.provider(selection.provider).generateText(prompt, {
        ...options,
        provider: selection.provider,
        model: selection.model,
      });
      this.health?.recordSuccess(
        selection.provider,
        selection.model ?? "default",
        Date.now() - started,
      );
      return result;
    } catch (error) {
      if (!options.signal?.aborted) {
        this.health?.recordFailure(
          selection.provider,
          selection.model ?? "default",
          error,
        );
      }
      throw error;
    }
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
    private readonly health?: ProviderHealthRegistry,
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
    for (const fallback of this.availableFallbacks()) {
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
    for (const fallback of this.availableFallbacks()) {
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

  private availableFallbacks(): readonly ModelSelection[] {
    if (!this.health) {
      return this.fallbacks;
    }
    const available = this.fallbacks.filter((fallback) =>
      this.health!.isAvailable(fallback.provider, fallback.model),
    );
    // If every fallback is cooling down, try them anyway rather than failing
    // immediately. The provider may have recovered before the cooldown elapsed.
    return available.length > 0 ? available : this.fallbacks;
  }
}
