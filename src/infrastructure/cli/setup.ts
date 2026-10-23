import { createInterface } from "node:readline/promises";
import type { AppConfig } from "../config/env.js";
import {
  PROVIDER_PRESETS,
  formatModelRef,
  parseModelRef,
  presetProvider,
  type ModelSelection,
  type ModelSettings,
  type ProviderPreset,
} from "../config/models.js";
import type { SecretStorePort } from "../../domain/ports/secret-store.port.js";
import { errorMessage } from "../../shared/text.js";
import { detectDeviceProfile, formatBytes } from "../models/device-profile.js";
import { listProviderModels } from "../models/model-discovery.js";
import {
  ensureProvider,
  providerFromId,
  saveModelSettings,
  setRole,
  type ModelRole,
} from "../models/model-config.store.js";
import { readSecretFromInput } from "./secrets.js";

export interface SetupIO {
  output: (text: string) => void;
  ask: (question: string) => Promise<string>;
  readSecret: (label: string) => Promise<string>;
}

export interface SetupOptions {
  provider?: string;
  main?: string;
  coding?: string;
  triage?: string;
  fallback?: string;
}

/**
 * Guided first-run setup. It detects the device, stores a provider key in the
 * OS keyring, discovers models, and writes only non-secret routing choices to
 * ARC_HOME/models.json.
 */
export async function runSetupCommand(
  config: AppConfig,
  secretStore: SecretStorePort,
  args: readonly string[],
  io: Partial<SetupIO> = {},
): Promise<number> {
  const output = io.output ?? ((text: string) => process.stdout.write(text));
  const options = parseSetupOptions(args);
  const profile = await detectDeviceProfile(config.workspaceDir);

  output("\nARC setup\n\n");
  output(
    [
      `Device: ${profile.platform}/${profile.arch}, ${profile.cpuCores} CPU cores`,
      `CPU: ${profile.cpuModel}`,
      `Memory: ${formatBytes(profile.freeMemoryBytes)} free of ${formatBytes(profile.totalMemoryBytes)}`,
      `Disk: ${formatBytes(profile.freeDiskBytes)} free`,
      `GPU: ${profile.gpu ? profile.gpu.name : "not detected"}`,
      `Tier: ${profile.tier}`,
      `Recommendation: ${profile.recommendation}`,
      ...profile.reasons.map((reason) => `  - ${reason}`),
      "",
    ].join("\n"),
  );

  const interactive = io.ask !== undefined || Boolean(process.stdin.isTTY);
  let rl: ReturnType<typeof createInterface> | undefined;
  const ask =
    io.ask ??
    (async (question: string): Promise<string> => {
      rl ??= createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      return rl.question(question);
    });
  const readSecret = io.readSecret ?? readSecretFromInput;

  try {
    const providerId =
      options.provider ??
      (await chooseProvider(output, ask, secretStore, config));
    const provider =
      config.models.providers[providerId] ??
      providerFromId(
        providerId,
        providerId === "ollama" ? config.ollama.baseUrl : undefined,
      );

    let apiKey: string | null = null;
    if (provider.apiKeyAccount) {
      apiKey = await secretStore.get(provider.apiKeyAccount);
      if (!apiKey) {
        if (!interactive && options.main) {
          output(
            `Provider key is missing. Run: arc secrets set ${provider.apiKeyAccount}\n`,
          );
          return 1;
        }
        output(
          `\nPaste the API key for ${providerId}. It is stored only in the OS credential store.\n`,
        );
        // The hidden prompt owns stdin while it reads. Close the question
        // interface first so both readline consumers do not compete for input.
        if (rl) {
          rl.close();
          rl = undefined;
        }
        apiKey = (await readSecret("API key: ")).trim();
        if (apiKey.length < 8) {
          output("No key was stored. Setup cancelled.\n");
          return 1;
        }
        await secretStore.set(provider.apiKeyAccount, apiKey);
        output(`Stored ${provider.apiKeyAccount} in the OS credential store.\n`);
      }
    }

    const preset = PROVIDER_PRESETS.find((item) => item.id === providerId);
    output(`\nFetching models from ${preset?.name ?? providerId}…\n`);
    let models: Array<{ id: string; displayName?: string; contextLength?: number }>;
    try {
      models = await listProviderModels(provider, apiKey);
    } catch (error) {
      output(
        `Could not list models live: ${errorMessage(error)}\nUsing suggested model ids; you can type any model id.\n`,
      );
      models = suggestedModels(preset);
    }

    const mainModel =
      options.main ??
      (await chooseModel(
        output,
        ask,
        "Main model",
        models,
        preset?.suggestedModels.main ?? models[0]?.id ?? "",
      ));
    const codingModel =
      options.coding ??
      (interactive
        ? await chooseModel(
            output,
            ask,
            "Coding model",
            models,
            preset?.suggestedModels.coding ?? mainModel,
          )
        : mainModel);
    const triageModel =
      options.triage ??
      (interactive
        ? await chooseModel(
            output,
            ask,
            "Email triage model (cheap/fast)",
            models,
            preset?.suggestedModels.triage ?? mainModel,
          )
        : mainModel);

    let settings: ModelSettings = ensureProvider(config.models, provider);
    settings = setRole(settings, "main", {
      provider: providerId,
      model: mainModel,
    });
    settings = setRole(settings, "research", {
      provider: providerId,
      model: mainModel,
    });
    settings = setRole(settings, "coding", {
      provider: providerId,
      model: codingModel,
    });
    settings = setRole(settings, "triage", {
      provider: providerId,
      model: triageModel,
    });
    settings = setRole(settings, "compaction", {
      provider: providerId,
      model: triageModel,
    });

    const fallback = options.fallback
      ? parseModelRef(options.fallback)
      : undefined;
    if (fallback) {
      settings = {
        ...settings,
        fallback: [fallback],
      };
    }

    const filePath = await saveModelSettings(config.arcHome, settings);
    output(
      [
        "",
        "Saved model routing.",
        `  main:     ${formatModelRef(settings.roles.main)}`,
        `  research: ${formatModelRef(settings.roles.research)}`,
        `  coding:   ${formatModelRef(settings.roles.coding)}`,
        `  triage:   ${formatModelRef(settings.roles.triage)}`,
        `  compact:  ${formatModelRef(settings.roles.compaction)}`,
        ...(settings.fallback.length > 0
          ? [`  fallback: ${settings.fallback.map(formatModelRef).join(", ")}`]
          : []),
        `  file:     ${filePath}`,
        "",
        "Next: run `arc doctor`, then start ARC with `arc`.",
        "",
      ].join("\n"),
    );
    return 0;
  } catch (error) {
    output(`Setup failed: ${errorMessage(error)}\n`);
    return 1;
  } finally {
    rl?.close();
  }
}

export async function runModelsCommand(
  config: AppConfig,
  secretStore: SecretStorePort,
  args: readonly string[],
  output: (text: string) => void = (text) => process.stdout.write(text),
): Promise<number> {
  const [command, ...rest] = args;
  if (!command || command === "list" || command === "show") {
    await printModels(config, secretStore, output);
    return 0;
  }

  if (command === "set") {
    const [rawRole, reference] = rest;
    const role = rawRole === "decision" ? "triage" : rawRole;
    if (!isRole(role) || !reference) {
      output(
        "Usage: arc models set <main|research|coding|triage|compaction> <provider>/<model>\n",
      );
      return 1;
    }
    const selection = parseModelRef(reference);
    const provider = presetProvider(selection.provider) ??
      config.models.providers[selection.provider];
    if (!provider) {
      output(
        `Unknown provider "${selection.provider}". Run arc setup or add a custom provider first.\n`,
      );
      return 1;
    }
    let settings = ensureProvider(config.models, provider);
    settings = setRole(settings, role, selection);
    const filePath = await saveModelSettings(config.arcHome, settings);
    output(
      `Set ${role} to ${formatModelRef(selection)} in ${filePath}.\n`,
    );
    return 0;
  }

  if (command === "fallback") {
    const references = rest;
    if (references.length === 0) {
      output("Usage: arc models fallback <provider>/<model> [...]\n");
      return 1;
    }
    let settings = config.models;
    const fallbacks: ModelSelection[] = [];
    for (const reference of references) {
      const selection = parseModelRef(reference);
      const provider = presetProvider(selection.provider) ??
        config.models.providers[selection.provider];
      if (!provider) {
        output(`Unknown provider "${selection.provider}".\n`);
        return 1;
      }
      settings = ensureProvider(settings, provider);
      fallbacks.push(selection);
    }
    settings = { ...settings, fallback: fallbacks };
    const filePath = await saveModelSettings(config.arcHome, settings);
    output(
      `Fallback chain: ${fallbacks.map(formatModelRef).join(" → ")} (${filePath}).\n`,
    );
    return 0;
  }

  output(
    "Usage:\n  arc models\n  arc models set <role> <provider>/<model>\n  arc models fallback <provider>/<model> [...]\n",
  );
  return 1;
}

export async function runProvidersCommand(
  config: AppConfig,
  secretStore: SecretStorePort,
  args: readonly string[] = [],
  output: (text: string) => void = (text) => process.stdout.write(text),
): Promise<number> {
  const [command, id, baseUrl] = args;
  if (command === "add") {
    if (!id || !baseUrl) {
      output("Usage: arc providers add <id> <https-base-url>\n");
      return 1;
    }
    try {
      const provider = providerFromId(id, baseUrl);
      const settings = ensureProvider(config.models, provider);
      const filePath = await saveModelSettings(config.arcHome, settings);
      output(
        `Added provider ${provider.id} (${provider.kind}) at ${provider.baseUrl}.\nKey account: ${provider.apiKeyAccount || "(none)"}\nSaved ${filePath}.\n`,
      );
      return 0;
    } catch (error) {
      output(`Could not add provider: ${errorMessage(error)}\n`);
      return 1;
    }
  }

  if (command === "remove") {
    if (!id) {
      output("Usage: arc providers remove <id>\n");
      return 1;
    }
    const inUse =
      Object.values(config.models.roles).some(
        (selection) => selection.provider === id,
      ) ||
      config.models.fallback.some((selection) => selection.provider === id);
    if (inUse) {
      output(
        `Provider "${id}" is used by a routing role or fallback. Change those first.\n`,
      );
      return 1;
    }
    if (!config.models.providers[id]) {
      output(`Provider "${id}" is not configured.\n`);
      return 1;
    }
    const providers = { ...config.models.providers };
    delete providers[id];
    const settings = { ...config.models, providers };
    const filePath = await saveModelSettings(config.arcHome, settings);
    output(`Removed provider ${id}. Saved ${filePath}.\n`);
    return 0;
  }

  output("\nARC providers\n\n");
  for (const preset of PROVIDER_PRESETS) {
    let status = "not configured";
    if (preset.apiKeyAccount) {
      try {
        status = (await secretStore.get(preset.apiKeyAccount))
          ? "key set"
          : "key missing";
      } catch {
        status = "keyring unavailable";
      }
    } else {
      status = "no key required";
    }
    const selected = Object.values(config.models.roles).some(
      (selection) => selection.provider === preset.id,
    );
    output(
      `  ${selected ? "*" : " "} ${preset.name} (${preset.id}) — ${status}${preset.freeTier ? " — free tier" : ""}\n`,
    );
  }
  for (const [id, provider] of Object.entries(config.models.providers)) {
    if (PROVIDER_PRESETS.some((preset) => preset.id === id)) {
      continue;
    }
    const selected = Object.values(config.models.roles).some(
      (selection) => selection.provider === id,
    );
    output(
      `  ${selected ? "*" : " "} ${id} — ${provider.kind} at ${provider.baseUrl}\n`,
    );
  }
  output(
    "\nSet a key with: arc secrets set provider.<id>.api-key\nAdd a custom OpenAI-compatible provider: arc providers add <id> <https-base-url>\nRun arc setup to choose models.\n\n",
  );
  return 0;
}

async function printModels(
  config: AppConfig,
  secretStore: SecretStorePort,
  output: (text: string) => void,
): Promise<void> {
  const profile = await detectDeviceProfile(config.workspaceDir);
  output("\nARC model routing\n\n");
  output(`Device tier: ${profile.tier} — ${profile.recommendation}\n`);
  output(`Config: ${config.modelSettingsPath}\n\n`);
  for (const role of [
    "main",
    "research",
    "coding",
    "triage",
    "compaction",
  ] as const) {
    output(`  ${role.padEnd(11)} ${formatModelRef(config.models.roles[role])}\n`);
  }
  output(
    `  ${"fallback".padEnd(11)} ${
      config.models.fallback.length > 0
        ? config.models.fallback.map(formatModelRef).join(", ")
        : "(none)"
    }\n\n`,
  );
  for (const [id, provider] of Object.entries(config.models.providers)) {
    let status = "no key required";
    if (provider.apiKeyAccount) {
      try {
        status = (await secretStore.get(provider.apiKeyAccount))
          ? "key set"
          : "key missing";
      } catch {
        status = "keyring unavailable";
      }
    }
    output(`  ${id}: ${provider.kind} at ${provider.baseUrl} — ${status}\n`);
  }
  output("\nChange a role with: arc models set <role> <provider>/<model>\n\n");
}

async function chooseProvider(
  output: (text: string) => void,
  ask: (question: string) => Promise<string>,
  secretStore: SecretStorePort,
  config: AppConfig,
): Promise<string> {
  output("Choose a provider:\n");
  const choices = [
    ...PROVIDER_PRESETS.map((preset) => ({
      id: preset.id,
      name: preset.name,
      apiKeyAccount: preset.apiKeyAccount,
      freeTier: preset.freeTier,
    })),
    ...Object.values(config.models.providers)
      .filter(
        (provider) =>
          !PROVIDER_PRESETS.some((preset) => preset.id === provider.id),
      )
      .map((provider) => ({
        id: provider.id,
        name: `${provider.id} (custom)`,
        apiKeyAccount: provider.apiKeyAccount,
        freeTier: false,
      })),
  ];
  for (let index = 0; index < choices.length; index += 1) {
    const choice = choices[index];
    if (!choice) {
      continue;
    }
    let status = "no key required";
    if (choice.apiKeyAccount) {
      try {
        status = (await secretStore.get(choice.apiKeyAccount))
          ? "key set"
          : "key missing";
      } catch {
        status = "keyring unavailable";
      }
    }
    output(
      `  ${index + 1}. ${choice.name} — ${status}${choice.freeTier ? " — free tier" : ""}\n`,
    );
  }
  const answer = (await ask("Provider number or id [1]: ")).trim() || "1";
  const numeric = Number.parseInt(answer, 10);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= choices.length) {
    return choices[numeric - 1]?.id ?? "google";
  }
  if (choices.some((choice) => choice.id === answer)) {
    return answer;
  }
  throw new Error(`Unknown provider "${answer}".`);
}

async function chooseModel(
  output: (text: string) => void,
  ask: (question: string) => Promise<string>,
  label: string,
  models: Array<{ id: string; displayName?: string; contextLength?: number }>,
  fallback: string,
): Promise<string> {
  const sorted = [...models].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  output(`\n${label}:\n`);
  const shown = sorted.slice(0, 30);
  for (let index = 0; index < shown.length; index += 1) {
    const model = shown[index];
    if (!model) {
      continue;
    }
    const context = model.contextLength
      ? ` (${Math.round(model.contextLength / 1000)}k context)`
      : "";
    output(`  ${index + 1}. ${model.id}${context}\n`);
  }
  if (sorted.length > shown.length) {
    output(`  … ${sorted.length - shown.length} more\n`);
  }
  const answer = (
    await ask(
      `${label} number or exact id${fallback ? ` [${fallback}]` : ""}: `,
    )
  ).trim();
  if (!answer) {
    if (!fallback) {
      throw new Error(`No ${label.toLowerCase()} was selected.`);
    }
    return fallback;
  }
  const numeric = Number.parseInt(answer, 10);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= shown.length) {
    return shown[numeric - 1]?.id ?? fallback;
  }
  return answer;
}

function suggestedModels(
  preset: ProviderPreset | undefined,
): Array<{ id: string }> {
  if (!preset) {
    return [];
  }
  return [
    ...new Set([
      preset.suggestedModels.main,
      preset.suggestedModels.coding,
      preset.suggestedModels.triage,
    ]),
  ].map((id) => ({ id }));
}

function parseSetupOptions(args: readonly string[]): SetupOptions {
  const options: SetupOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (!arg || !next) {
      continue;
    }
    if (arg === "--provider") {
      options.provider = next;
      index += 1;
    } else if (arg === "--main") {
      options.main = next;
      index += 1;
    } else if (arg === "--coding") {
      options.coding = next;
      index += 1;
    } else if (arg === "--triage") {
      options.triage = next;
      index += 1;
    } else if (arg === "--fallback") {
      options.fallback = next;
      index += 1;
    }
  }
  return options;
}

function isRole(value: string | undefined): value is ModelRole {
  return (
    value === "main" ||
    value === "research" ||
    value === "coding" ||
    value === "triage" ||
    value === "compaction"
  );
}
