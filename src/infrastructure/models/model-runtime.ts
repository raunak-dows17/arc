import type { AppConfig } from "../config/env.js";
import {
  isLocalProvider,
  presetProvider,
  type ModelSelection,
  type ModelSettings,
  type ProviderSettings,
} from "../config/models.js";
import type { SecretStorePort } from "../../domain/ports/secret-store.port.js";
import { LlmError } from "../../domain/errors/agent.errors.js";
import { OllamaDecisionAdapter } from "../llm/ollama-decision.adapter.js";
import { OllamaLlmAdapter } from "../llm/ollama.adapter.js";
import { GoogleGeminiAdapter } from "../llm/google-gemini.adapter.js";
import { OpenAiCompatibleAdapter } from "../llm/openai-compatible.adapter.js";
import {
  FallbackLlmAdapter,
  RoutingLlmAdapter,
  type ProviderLlm,
} from "../llm/routing-llm.adapter.js";
import { LlmDecisionModelAdapter } from "../llm/llm-decision.adapter.js";
import { SerializedLlmAdapter } from "../llm/serialized-llm.adapter.js";
import type { DecisionModelPort } from "../../domain/ports/decision-model.port.js";
import type { ProviderHealthRegistry } from "./provider-health.js";
import { listProviderModels } from "./model-discovery.js";

export interface ModelRuntime {
  llm: SerializedLlmAdapter;
  routing: RoutingLlmAdapter;
  decisionModel: DecisionModelPort;
  providers: Record<string, ProviderLlm>;
  settings: ModelSettings;
}

export interface CreateModelRuntimeOptions {
  health?: ProviderHealthRegistry;
}

/**
 * Adds installed local models to the candidate pool at startup. The pool is
 * kept in memory: model discovery is a cache, not a configuration write. This
 * is what makes hybrid mode useful without requiring users to enumerate every
 * local model manually.
 */
export async function withDiscoveredLocalModels(
  config: AppConfig,
): Promise<AppConfig> {
  if (config.models.mode === "cloud") {
    return config;
  }
  const settings = config.models;
  const localIds = new Set<string>();
  for (const [id, provider] of Object.entries(settings.providers)) {
    if (isLocalProvider(provider)) {
      localIds.add(id);
    }
  }
  // Ollama is the default local runtime even when it has no role yet.
  localIds.add("ollama");

  const providers = { ...settings.providers };
  const pool = new Map(
    settings.pool.map((selection) => [formatSelection(selection), selection]),
  );
  let changed = false;
  for (const id of localIds) {
    let provider: ProviderSettings;
    try {
      provider = resolveProvider(id, config);
    } catch {
      continue;
    }
    if (!isLocalProvider(provider)) {
      continue;
    }
    try {
      const discovered = await listProviderModels(
        provider,
        null,
        AbortSignal.timeout(1_500),
      );
      if (discovered.length === 0) {
        continue;
      }
      providers[id] = provider;
      for (const model of discovered) {
        const selection = { provider: id, model: model.id };
        pool.set(formatSelection(selection), selection);
      }
      changed = true;
    } catch {
      // A local runtime that is not running is optional.
    }
  }

  if (!changed && Object.keys(providers).length === Object.keys(settings.providers).length) {
    return config;
  }
  return {
    ...config,
    models: {
      ...settings,
      providers,
      pool: [...pool.values()],
    },
  };
}

function formatSelection(selection: ModelSelection): string {
  return `${selection.provider}/${selection.model}`;
}

/**
 * Creates provider adapters for the providers selected by the routing table,
 * pool, or fallback chain. Optional providers without keys are marked
 * unavailable so the orchestrator can route around them.
 */
export async function createModelRuntime(
  config: AppConfig,
  secretStore: SecretStorePort,
  options: CreateModelRuntimeOptions = {},
): Promise<ModelRuntime> {
  const settings = config.models;
  const used = usedProviders(settings);
  const providers: Record<string, ProviderLlm> = {};

  for (const id of used) {
    const provider = resolveProvider(id, config);
    if (provider.kind === "ollama") {
      providers[id] = new OllamaLlmAdapter({
        ...config.ollama,
        baseUrl: provider.baseUrl,
      });
      continue;
    }

    const account =
      provider.apiKeyAccount || `provider.${provider.id}.api-key`;
    const local = isLocalProvider(provider);
    const apiKey = local ? "local" : await secretStore.get(account);
    if (!apiKey) {
      // A missing key for an optional provider must not prevent ARC from
      // starting with the other models in the pool.
      options.health?.markUnavailable(
        id,
        "*",
        `Provider "${id}" needs an API key. Run: arc secrets set ${account}`,
      );
      continue;
    }

    if (provider.kind === "google") {
      providers[id] = new GoogleGeminiAdapter({
        providerId: id,
        baseUrl: provider.baseUrl,
        apiKey,
        timeoutMs: config.ollama.timeoutMs,
      });
    } else {
      providers[id] = new OpenAiCompatibleAdapter({
        providerId: id,
        baseUrl: provider.baseUrl,
        apiKey,
        jsonMode: provider.jsonMode,
        timeoutMs: config.ollama.timeoutMs,
      });
    }
  }

  const mainSelection = providers[settings.roles.main.provider]
    ? settings.roles.main
    : firstAvailableSelection(settings, providers);
  if (!mainSelection) {
    throw new LlmError(
      "No model providers are available. Run \"arc doctor\" or \"arc setup\".",
    );
  }

  const routing = new RoutingLlmAdapter(
    providers,
    mainSelection,
    options.health,
  );
  const resilient = new FallbackLlmAdapter(
    routing,
    settings.fallback,
    options.health,
  );
  const triage = providers[settings.roles.triage.provider]
    ? settings.roles.triage
    : mainSelection;
  const triageProvider = resolveProvider(triage.provider, config);
  const decisionModel =
    triageProvider.systemOne === true ||
    (triage.provider === "ollama" &&
      providers[triage.provider] instanceof OllamaLlmAdapter)
      ? new OllamaDecisionAdapter({
          baseUrl:
            triage.provider === "ollama" &&
            config.ollama.decisionBaseUrl !== config.ollama.baseUrl
              ? config.ollama.decisionBaseUrl
              : triageProvider.baseUrl,
          model: triage.model,
          keepAlive: config.ollama.keepAlive,
          timeoutMs: config.ollama.timeoutMs,
        })
      : new LlmDecisionModelAdapter(resilient, triage);

  return {
    llm: new SerializedLlmAdapter(resilient, decisionModel),
    routing,
    decisionModel,
    providers,
    settings,
  };
}

export async function checkSelectedOllamaModels(
  config: AppConfig,
  runtime: ModelRuntime,
  healthRegistry?: ProviderHealthRegistry,
): Promise<string[]> {
  const warnings: string[] = [];
  for (const [id, provider] of Object.entries(runtime.providers)) {
    if (!(provider instanceof OllamaLlmAdapter)) {
      continue;
    }
    const settings = resolveProvider(id, config);
    const selections = [
      ...Object.values(config.models.roles),
      ...config.models.pool,
    ].filter((selection) => selection.provider === id);
    const models = [...new Set(selections.map((selection) => selection.model))];
    let health;
    try {
      health = await provider.checkHealth(models);
    } catch (error) {
      healthRegistry?.markUnavailable(
        id,
        "*",
        error instanceof Error ? error.message : String(error),
      );
      warnings.push(
        `Ollama provider "${id}" is not reachable: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    warnings.push(...health.warnings);
    for (const missing of health.missingModels) {
      healthRegistry?.markUnavailable(
        id,
        missing,
        `Model "${missing}" is not installed. Run: ollama pull ${missing}`,
      );
    }
    if (
      health.missingModels.includes(config.models.roles.main.model) &&
      config.models.roles.main.provider === id
    ) {
      warnings.push(
        `The selected main model "${config.models.roles.main.model}" is not installed. Run: ollama pull ${config.models.roles.main.model}`,
      );
    }
    if (settings.baseUrl !== config.ollama.baseUrl) {
      warnings.push(
        `Ollama provider "${id}" uses ${settings.baseUrl} instead of ${config.ollama.baseUrl}.`,
      );
    }
  }
  return warnings;
}

export function resolveProvider(
  id: string,
  config: AppConfig,
): ProviderSettings {
  const configured = config.models.providers[id];
  if (configured) {
    return configured;
  }
  if (id === "ollama") {
    return {
      id,
      kind: "ollama",
      baseUrl: config.ollama.baseUrl,
      apiKeyAccount: "",
      jsonMode: true,
    };
  }
  const preset = presetProvider(id);
  if (preset) {
    return preset;
  }
  throw new LlmError(
    `Provider "${id}" is not configured. Add it to ARC_HOME/models.json or run "arc setup".`,
  );
}

function usedProviders(settings: ModelSettings): string[] {
  const ids = new Set<string>();
  for (const selection of Object.values(settings.roles)) {
    ids.add(selection.provider);
  }
  for (const selection of settings.pool) {
    ids.add(selection.provider);
  }
  for (const selection of settings.fallback) {
    ids.add(selection.provider);
  }
  return [...ids];
}

function firstAvailableSelection(
  settings: ModelSettings,
  providers: Readonly<Record<string, ProviderLlm>>,
): ModelSelection | null {
  for (const selection of [
    ...Object.values(settings.roles),
    ...settings.pool,
    ...settings.fallback,
  ]) {
    if (providers[selection.provider]) {
      return selection;
    }
  }
  return null;
}

export function selectionLabel(selection: ModelSelection): string {
  return `${selection.provider}/${selection.model}`;
}
