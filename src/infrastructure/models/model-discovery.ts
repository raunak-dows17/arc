import { z } from "zod";
import {
  isLocalProvider,
  type ProviderSettings,
} from "../config/models.js";
import { GoogleGeminiAdapter } from "../llm/google-gemini.adapter.js";
import { OpenAiCompatibleAdapter } from "../llm/openai-compatible.adapter.js";

export interface DiscoveredModel {
  id: string;
  displayName?: string;
  contextLength?: number;
}

const ollamaTagsSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      size: z.number().optional(),
    }),
  ),
});

export async function listProviderModels(
  provider: ProviderSettings,
  apiKey: string | null,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveredModel[]> {
  if (provider.kind === "ollama") {
    const response = await fetchImpl(
      `${provider.baseUrl.replace(/\/+$/, "")}/api/tags`,
      { signal: signal ?? AbortSignal.timeout(5_000) },
    );
    if (!response.ok) {
      throw new Error(`Ollama model list failed with HTTP ${response.status}.`);
    }
    const parsed = ollamaTagsSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("Ollama returned an unexpected model list.");
    }
    return parsed.data.models.map((model) => ({ id: model.name }));
  }

  if (!apiKey && !isLocalProvider(provider)) {
    throw new Error(
      `Provider "${provider.id}" needs an API key before its models can be listed.`,
    );
  }

  if (provider.kind === "google") {
    const adapter = new GoogleGeminiAdapter({
      providerId: provider.id,
      baseUrl: provider.baseUrl,
      apiKey: apiKey ?? "local",
    });
    return adapter.listModels(signal);
  }

  const adapter = new OpenAiCompatibleAdapter({
    providerId: provider.id,
    baseUrl: provider.baseUrl,
    apiKey: apiKey ?? "local",
    jsonMode: provider.jsonMode,
  });
  return adapter.listModels(signal);
}
