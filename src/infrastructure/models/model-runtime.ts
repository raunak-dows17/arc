import type { AppConfig } from "../config/env.js";
import {
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

export interface ModelRuntime {
  llm: SerializedLlmAdapter;
  routing: RoutingLlmAdapter;
  decisionModel: DecisionModelPort;
  providers: Record<string, ProviderLlm>;
  settings: ModelSettings;
}

/**
 * Creates provider adapters only for the providers actually selected by the
 * routing table or fallback chain. A missing key is a startup error with an
 * actionable command, not a silent switch to a local model.
 */
export async function createModelRuntime(
  config: AppConfig,
  secretStore: SecretStorePort,
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
    const apiKey = await secretStore.get(account);
    if (!apiKey) {
      throw new LlmError(
        `Provider "${id}" needs an API key. Run: arc secrets set ${account}`,
      );
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

  const routing = new RoutingLlmAdapter(providers, settings.roles.main);
  const resilient = new FallbackLlmAdapter(routing, settings.fallback);
  const triage = settings.roles.triage;
  const decisionModel =
    triage.provider === "ollama" &&
    providers[triage.provider] instanceof OllamaLlmAdapter
      ? new OllamaDecisionAdapter({
          baseUrl:
            config.ollama.decisionBaseUrl !== config.ollama.baseUrl
              ? config.ollama.decisionBaseUrl
              : resolveProvider(triage.provider, config).baseUrl,
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
): Promise<string[]> {
  const warnings: string[] = [];
  for (const [id, provider] of Object.entries(runtime.providers)) {
    if (!(provider instanceof OllamaLlmAdapter)) {
      continue;
    }
    const settings = resolveProvider(id, config);
    const roles = Object.values(config.models.roles)
      .filter((selection) => selection.provider === id)
      .map((selection) => selection.model);
    let health;
    try {
      health = await provider.checkHealth([...new Set(roles)]);
    } catch (error) {
      warnings.push(
        `Ollama provider "${id}" is not reachable: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    warnings.push(...health.warnings);
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
  for (const selection of settings.fallback) {
    ids.add(selection.provider);
  }
  return [...ids];
}

export function selectionLabel(selection: ModelSelection): string {
  return `${selection.provider}/${selection.model}`;
}
