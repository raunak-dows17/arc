import {
  isLocalProvider,
  presetProvider,
  type ModelSelection,
  type ModelSettings,
} from "../config/models.js";

export type ModelTask =
  | "main"
  | "research"
  | "coding"
  | "triage"
  | "compaction";

export interface ModelDescriptor {
  provider: string;
  model: string;
  local: boolean;
  toolCalling: boolean;
  jsonMode: boolean;
  contextWindow: number;
  /** 0–1 estimates used for routing, not benchmarks. */
  quality: number;
  coding: number;
  triage: number;
  speed: number;
  costTier: 0 | 1 | 2;
  /** Local models are always eligible for sensitive data. */
  sensitiveDataAllowed: boolean;
}

interface ModelProfile {
  quality: number;
  coding: number;
  triage: number;
  speed: number;
  toolCalling: boolean;
  contextWindow: number;
}

const KNOWN_MODELS: Record<string, Partial<ModelProfile>> = {
  "qwen3:8b": {
    quality: 0.66,
    coding: 0.6,
    triage: 0.55,
    speed: 0.8,
    toolCalling: true,
    contextWindow: 8_192,
  },
  "qwen2.5-coder:7b": {
    quality: 0.66,
    coding: 0.82,
    triage: 0.5,
    speed: 0.8,
    toolCalling: true,
    contextWindow: 8_192,
  },
  "qwen3:0.6b": {
    quality: 0.35,
    coding: 0.3,
    triage: 0.45,
    speed: 1,
    toolCalling: false,
    contextWindow: 8_192,
  },
  "tev1:0.8b": {
    quality: 0.3,
    coding: 0.2,
    triage: 0.92,
    speed: 1,
    toolCalling: false,
    contextWindow: 4_096,
  },
  "qwen3-coder-30b-a3b": {
    quality: 0.82,
    coding: 0.88,
    triage: 0.55,
    speed: 0.25,
    toolCalling: true,
    contextWindow: 32_768,
  },
  "qwen3.6-35b-a3b": {
    quality: 0.86,
    coding: 0.82,
    triage: 0.6,
    speed: 0.2,
    toolCalling: true,
    contextWindow: 32_768,
  },
  olmoe: {
    quality: 0.45,
    coding: 0.35,
    triage: 0.5,
    speed: 0.7,
    toolCalling: false,
    contextWindow: 8_192,
  },
  laya: {
    quality: 0.3,
    coding: 0.2,
    triage: 0.95,
    speed: 1,
    toolCalling: false,
    contextWindow: 4_096,
  },
  "gemini-3.6-flash": {
    quality: 0.9,
    coding: 0.86,
    triage: 0.8,
    speed: 0.9,
    toolCalling: true,
    contextWindow: 1_000_000,
  },
  "gemini-3.5-flash-lite": {
    quality: 0.75,
    coding: 0.62,
    triage: 0.9,
    speed: 1,
    toolCalling: true,
    contextWindow: 1_000_000,
  },
  "llama-3.3-70b-versatile": {
    quality: 0.84,
    coding: 0.75,
    triage: 0.75,
    speed: 0.9,
    toolCalling: true,
    contextWindow: 128_000,
  },
  "qwen/qwen3-32b": {
    quality: 0.8,
    coding: 0.84,
    triage: 0.65,
    speed: 0.9,
    toolCalling: true,
    contextWindow: 128_000,
  },
  "qwen/qwen-2.5-coder-32b-instruct:free": {
    quality: 0.8,
    coding: 0.88,
    triage: 0.6,
    speed: 0.85,
    toolCalling: true,
    contextWindow: 128_000,
  },
};

/**
 * Builds the candidate pool from configured roles, the optional pool, and the
 * fallback chain. Discovery is intentionally separate: ARC must not depend on
 * a live network call to choose a model.
 */
export class ModelCatalog {
  constructor(private readonly settings: ModelSettings) {}

  list(): ModelDescriptor[] {
    const selections = new Map<string, ModelSelection>();
    for (const selection of [
      ...Object.values(this.settings.roles),
      ...this.settings.pool,
      ...this.settings.fallback,
    ]) {
      if (
        !this.settings.providers[selection.provider] &&
        !presetProvider(selection.provider)
      ) {
        continue;
      }
      selections.set(`${selection.provider}/${selection.model}`, selection);
    }
    return [...selections.values()].map((selection) =>
      this.describe(selection),
    );
  }

  describe(selection: ModelSelection): ModelDescriptor {
    const provider =
      this.settings.providers[selection.provider] ??
      presetProvider(selection.provider) ??
      undefined;
    const local = provider ? isLocalProvider(provider) : false;
    const known = findKnown(selection.model);
    const isSmall = estimateParameters(selection.model) < 1.5;
    const isCloud = !local;
    const profile: ModelProfile = {
      quality: isCloud ? 0.78 : 0.55,
      coding: isCloud ? 0.72 : 0.5,
      triage: isCloud ? 0.65 : 0.5,
      speed: isCloud ? 0.9 : 0.75,
      toolCalling: !isSmall,
      contextWindow: isCloud ? 128_000 : 8_192,
      ...known,
    };
    return {
      provider: selection.provider,
      model: selection.model,
      local,
      toolCalling: profile.toolCalling,
      jsonMode: provider?.jsonMode ?? true,
      contextWindow: profile.contextWindow,
      quality: profile.quality,
      coding: profile.coding,
      triage: profile.triage,
      speed: profile.speed,
      costTier: local ? 0 : 1,
      sensitiveDataAllowed: local,
    };
  }
}

function findKnown(model: string): Partial<ModelProfile> {
  const normalized = model.toLowerCase();
  const exact = KNOWN_MODELS[normalized];
  if (exact) {
    return exact;
  }
  const match = Object.entries(KNOWN_MODELS).find(([id]) =>
    normalized.includes(id.toLowerCase()),
  );
  return match?.[1] ?? {};
}

function estimateParameters(model: string): number {
  const match = model.toLowerCase().match(/(\d+(?:\.\d+)?)\s*b/);
  if (match?.[1]) {
    return Number.parseFloat(match[1]);
  }
  return 7;
}
