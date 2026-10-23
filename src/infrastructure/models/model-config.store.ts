import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  modelSettingsPath,
  presetProvider,
  type ModelRoleSettings,
  type ModelSelection,
  type ModelSettings,
  type ProviderSettings,
} from "../config/models.js";

export type ModelRole = keyof ModelRoleSettings;

export function setRole(
  settings: ModelSettings,
  role: ModelRole,
  selection: ModelSelection,
): ModelSettings {
  return {
    ...settings,
    roles: {
      ...settings.roles,
      [role]: { ...selection },
    },
  };
}

export function setFallbacks(
  settings: ModelSettings,
  fallback: readonly ModelSelection[],
): ModelSettings {
  return {
    ...settings,
    fallback: fallback.map((selection) => ({ ...selection })),
  };
}

export function ensureProvider(
  settings: ModelSettings,
  provider: ProviderSettings,
): ModelSettings {
  return {
    ...settings,
    providers: {
      ...settings.providers,
      [provider.id]: { ...provider },
    },
  };
}

export function providerFromId(
  id: string,
  baseUrl?: string,
): ProviderSettings {
  if (baseUrl) {
    assertProviderUrl(baseUrl);
  }
  const preset = presetProvider(id, baseUrl ? { baseUrl } : {});
  if (preset) {
    return preset;
  }
  if (!baseUrl) {
    throw new Error(
      `Unknown provider "${id}". Use a built-in provider or pass --base-url for a custom OpenAI-compatible provider.`,
    );
  }
  return {
    id,
    kind: "openai-compatible",
    baseUrl,
    apiKeyAccount: `provider.${id}.api-key`,
    jsonMode: true,
  };
}

function assertProviderUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Provider base URL is not a valid URL: ${value}`);
  }
  const local =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(
      `Provider base URL must use HTTPS (HTTP is allowed only for localhost): ${value}`,
    );
  }
}

export async function saveModelSettings(
  arcHome: string,
  settings: ModelSettings,
): Promise<string> {
  const filePath = modelSettingsPath(arcHome);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, filePath);
  return filePath;
}
