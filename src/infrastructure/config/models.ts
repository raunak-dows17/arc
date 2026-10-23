import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export type ProviderKind = "ollama" | "google" | "openai-compatible";

export interface ModelSelection {
  provider: string;
  model: string;
}

export interface ProviderSettings {
  id: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Keyring account name. Empty for providers that do not use a key. */
  apiKeyAccount: string;
  /** Whether the provider reliably supports a JSON response mode. */
  jsonMode: boolean;
}

export interface ModelRoleSettings {
  main: ModelSelection;
  research: ModelSelection;
  coding: ModelSelection;
  triage: ModelSelection;
  compaction: ModelSelection;
}

export interface ModelSettings {
  version: 1;
  providers: Record<string, ProviderSettings>;
  roles: ModelRoleSettings;
  fallback: ModelSelection[];
}

export interface ProviderPreset {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKeyAccount: string;
  docsUrl: string;
  freeTier: boolean;
  jsonMode: boolean;
  description: string;
  suggestedModels: {
    main: string;
    coding: string;
    triage: string;
  };
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: "google",
    name: "Google Gemini",
    kind: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyAccount: "provider.google.api-key",
    docsUrl: "https://aistudio.google.com/app/apikey",
    freeTier: true,
    jsonMode: true,
    description:
      "Gemini Flash and Flash-Lite models. Good free-tier choice for chat, coding, and structured decisions.",
    suggestedModels: {
      main: "gemini-3.6-flash",
      coding: "gemini-3.6-flash",
      triage: "gemini-3.5-flash-lite",
    },
  },
  {
    id: "groq",
    name: "Groq",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyAccount: "provider.groq.api-key",
    docsUrl: "https://console.groq.com/keys",
    freeTier: true,
    jsonMode: true,
    description:
      "Fast OpenAI-compatible inference with a free tier. Good for Llama and Qwen models.",
    suggestedModels: {
      main: "llama-3.3-70b-versatile",
      coding: "qwen/qwen3-32b",
      triage: "llama-3.1-8b-instant",
    },
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyAccount: "provider.openrouter.api-key",
    docsUrl: "https://openrouter.ai/keys",
    freeTier: true,
    jsonMode: true,
    description:
      "Many models behind one API. Free model ids usually end in :free and have rate limits.",
    suggestedModels: {
      main: "meta-llama/llama-3.3-70b-instruct:free",
      coding: "qwen/qwen-2.5-coder-32b-instruct:free",
      triage: "meta-llama/llama-3.2-3b-instruct:free",
    },
  },
  {
    id: "cerebras",
    name: "Cerebras",
    kind: "openai-compatible",
    baseUrl: "https://api.cerebras.ai/v1",
    apiKeyAccount: "provider.cerebras.api-key",
    docsUrl: "https://cloud.cerebras.ai/",
    freeTier: true,
    jsonMode: true,
    description:
      "Very fast OpenAI-compatible inference with a free tier for supported models.",
    suggestedModels: {
      main: "llama-3.3-70b",
      coding: "qwen-3-32b",
      triage: "llama3.1-8b",
    },
  },
  {
    id: "mistral",
    name: "Mistral AI",
    kind: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyAccount: "provider.mistral.api-key",
    docsUrl: "https://console.mistral.ai/api-keys/",
    freeTier: true,
    jsonMode: true,
    description:
      "Mistral models through an OpenAI-compatible endpoint. Free-tier availability depends on the account.",
    suggestedModels: {
      main: "mistral-small-latest",
      coding: "codestral-latest",
      triage: "open-mistral-nemo",
    },
  },
  {
    id: "github",
    name: "GitHub Models",
    kind: "openai-compatible",
    baseUrl: "https://models.github.ai/inference",
    apiKeyAccount: "provider.github.api-key",
    docsUrl: "https://github.com/settings/tokens",
    freeTier: true,
    jsonMode: true,
    description:
      "OpenAI-compatible GitHub Models endpoint. Use a GitHub token with models access.",
    suggestedModels: {
      main: "openai/gpt-4o-mini",
      coding: "openai/gpt-4o",
      triage: "openai/gpt-4o-mini",
    },
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    kind: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    apiKeyAccount: "",
    docsUrl: "https://ollama.com/",
    freeTier: true,
    jsonMode: true,
    description:
      "Local models. Optional, and best reserved for machines with enough RAM or a capable GPU.",
    suggestedModels: {
      main: "qwen3:8b",
      coding: "qwen2.5-coder:7b",
      triage: "tev1:0.8b",
    },
  },
];

const selectionSchema = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
});

const providerSchema = z.object({
  id: z.string().trim().min(1),
  kind: z.enum(["ollama", "google", "openai-compatible"]),
  baseUrl: z.string().trim().url(),
  apiKeyAccount: z.string().trim().default(""),
  jsonMode: z.boolean().default(true),
});

const settingsSchema = z.object({
  version: z.literal(1),
  providers: z.record(z.string(), providerSchema),
  roles: z.object({
    main: selectionSchema,
    research: selectionSchema,
    coding: selectionSchema,
    triage: selectionSchema,
    compaction: selectionSchema,
  }),
  fallback: z.array(selectionSchema).default([]),
});

export function presetProvider(
  id: string,
  overrides: Partial<ProviderSettings> = {},
): ProviderSettings | null {
  const preset = PROVIDER_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) {
    return null;
  }
  return {
    id: preset.id,
    kind: preset.kind,
    baseUrl: preset.baseUrl,
    apiKeyAccount: preset.apiKeyAccount,
    jsonMode: preset.jsonMode,
    ...overrides,
  };
}

export function legacyModelSettings(input: {
  ollamaBaseUrl: string;
  main: string;
  research: string;
  coding: string;
  decision: string;
}): ModelSettings {
  return {
    version: 1,
    providers: {
      ollama: {
        id: "ollama",
        kind: "ollama",
        baseUrl: input.ollamaBaseUrl,
        apiKeyAccount: "",
        jsonMode: true,
      },
    },
    roles: {
      main: { provider: "ollama", model: input.main },
      research: { provider: "ollama", model: input.research },
      coding: { provider: "ollama", model: input.coding },
      triage: { provider: "ollama", model: input.decision },
      compaction: { provider: "ollama", model: input.main },
    },
    fallback: [],
  };
}

export interface LoadModelSettingsInput {
  arcHome: string;
  env: NodeJS.ProcessEnv;
  legacy: {
    ollamaBaseUrl: string;
    main: string;
    research: string;
    coding: string;
    decision: string;
  };
}

/**
 * Loads non-secret model routing from ARC_HOME/models.json. Environment
 * variables remain supported so existing Ollama installations keep working.
 */
export function loadModelSettings(input: LoadModelSettingsInput): ModelSettings {
  const filePath = path.join(input.arcHome, "models.json");
  let settings = legacyModelSettings(input.legacy);
  let loadedFromFile = false;

  if (existsSync(filePath)) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid ${filePath}: ${message}`);
    }
    const parsed = settingsSchema.safeParse(parsedJson);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new Error(`Invalid ${filePath}: ${details}`);
    }
    settings = parsed.data;
    loadedFromFile = true;
  }

  const providerId = input.env.ARC_MODEL_PROVIDER?.trim();
  if (providerId) {
    const existing = settings.providers[providerId];
    const provider =
      existing ??
      presetProvider(
        providerId,
        providerId === "ollama"
          ? { baseUrl: input.legacy.ollamaBaseUrl }
          : {},
      );
    if (!provider) {
      throw new Error(
        `ARC_MODEL_PROVIDER=\"${providerId}\" is not a built-in provider. Add it to ${filePath} first.`,
      );
    }
    settings = {
      ...settings,
      providers: {
        ...settings.providers,
        [providerId]: provider,
      },
    };
    const previous = settings.roles;
    const sameProvider = previous.main.provider === providerId;
    const main = sameProvider
      ? previous.main.model
      : (input.env.ARC_MODEL ??
        (providerId === "ollama" ? input.legacy.main : undefined));
    if (!main) {
      throw new Error(
        `ARC_MODEL_PROVIDER="${providerId}" needs ARC_MODEL when models.json has no ${providerId} main model.`,
      );
    }
    // When models.json already routes to this provider, keep its role choices.
    // This avoids stale legacy ARC_*_MODEL values in an existing .env silently
    // switching a cloud provider back to local model ids.
    const research = sameProvider
      ? previous.research.model
      : providerId === "ollama"
        ? (input.env.ARC_RESEARCH_MODEL ?? input.legacy.research)
        : main;
    const coding = sameProvider
      ? previous.coding.model
      : providerId === "ollama"
        ? (input.env.ARC_CODING_MODEL ?? input.legacy.coding)
        : main;
    const triage = sameProvider
      ? previous.triage.model
      : providerId === "ollama"
        ? (input.env.ARC_DECISION_MODEL ?? input.legacy.decision)
        : main;
    const compaction = sameProvider ? previous.compaction.model : main;
    settings.roles = {
      main: { provider: providerId, model: main },
      research: { provider: providerId, model: research },
      coding: { provider: providerId, model: coding },
      triage: { provider: providerId, model: triage },
      compaction: { provider: providerId, model: compaction },
    };
  } else if (!loadedFromFile && input.env.ARC_MODEL) {
    settings.roles = {
      ...settings.roles,
      main: { provider: "ollama", model: input.env.ARC_MODEL },
      research: {
        provider: "ollama",
        model: input.env.ARC_RESEARCH_MODEL ?? input.env.ARC_MODEL,
      },
      compaction: { provider: "ollama", model: input.env.ARC_MODEL },
    };
    if (input.env.ARC_CODING_MODEL) {
      settings.roles.coding = {
        provider: "ollama",
        model: input.env.ARC_CODING_MODEL,
      };
    }
    if (input.env.ARC_DECISION_MODEL) {
      settings.roles.triage = {
        provider: "ollama",
        model: input.env.ARC_DECISION_MODEL,
      };
    }
  }

  return settings;
}

export function parseModelRef(value: string): ModelSelection {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) {
    throw new Error(
      `Model reference "${value}" must use the form provider/model.`,
    );
  }
  return {
    provider: value.slice(0, slash),
    model: value.slice(slash + 1),
  };
}

export function formatModelRef(selection: ModelSelection): string {
  return `${selection.provider}/${selection.model}`;
}

export function modelSettingsPath(arcHome: string): string {
  return path.join(arcHome, "models.json");
}
