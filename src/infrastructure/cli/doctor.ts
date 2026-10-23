import { mkdir, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../config/env.js";
import type { SecretStorePort } from "../../domain/ports/secret-store.port.js";
import { NapiKeyringSecretStore } from "../secrets/napi-keyring.secret-store.js";
import { pathComparisonKey } from "../../domain/services/portable-path.js";
import { SECRET_ACCOUNTS } from "../../shared/secret-accounts.js";

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
  warnings: number;
}

export interface DoctorOptions {
  secretStore?: SecretStorePort;
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
  nodeVersion?: string;
  totalMemory?: number;
  freeMemory?: number;
  minimumFreeDiskBytes?: number;
}

/**
 * Local health check for the ARC runtime. It never sends secrets or performs
 * model inference; it only verifies paths, credentials, Ollama, and resources.
 */
export async function runDoctor(
  config: AppConfig,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const platform = options.platform ?? process.platform;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const fetchImpl = options.fetchImpl ?? fetch;
  const secretStore = options.secretStore ?? new NapiKeyringSecretStore();

  const nodeMajor = Number.parseInt(nodeVersion.split(".")[0] ?? "0", 10);
  checks.push({
    id: "node",
    label: "Node.js",
    status: nodeMajor >= 20 ? "ok" : "fail",
    detail: `v${nodeVersion}${nodeMajor >= 20 ? "" : " (ARC requires Node 20+)"}`,
  });

  checks.push({
    id: "platform",
    label: "Platform",
    status: platform === "win32" ? "ok" : "warn",
    detail:
      platform === "win32"
        ? "Windows 11 production runtime"
        : `${platform} (development mode; production target is Windows 11)`,
  });

  const homeInsideWorkspace =
    pathComparisonKey(config.arcHome, platform) ===
      pathComparisonKey(config.workspaceDir, platform) ||
    pathComparisonKey(config.arcHome, platform).startsWith(
      `${pathComparisonKey(config.workspaceDir, platform)}${path.sep}`,
    );
  checks.push({
    id: "paths",
    label: "State separation",
    status: homeInsideWorkspace ? "fail" : "ok",
    detail: homeInsideWorkspace
      ? "ARC_HOME is inside ARC_WORKSPACE."
      : `ARC_HOME=${config.arcHome}; workspace=${config.workspaceDir}`,
  });

  checks.push(
    await pathCheck("arc-home", "ARC home", config.arcHome, "directory"),
  );
  checks.push(
    await pathCheck(
      "workspace",
      "Workspace",
      config.workspaceDir,
      "directory",
    ),
  );

  const keyring = await secretStore.healthCheck();
  checks.push({
    id: "keyring",
    label: "Credential store",
    status: keyring.ok ? "ok" : "fail",
    detail: keyring.message,
  });
  checks.push(await braveCheck(secretStore));
  checks.push(await emailCheck(config, secretStore));
  checks.push(await telegramCheck(config, secretStore));

  checks.push(await ollamaCheck(config, fetchImpl));
  checks.push(await modelCheck(config, fetchImpl));

  const totalMemory = options.totalMemory ?? os.totalmem();
  const freeMemory = options.freeMemory ?? os.freemem();
  const memoryGb = (value: number) => `${(value / 1024 ** 3).toFixed(1)} GB`;
  checks.push({
    id: "memory",
    label: "Memory",
    status: totalMemory >= 15 * 1024 ** 3 ? "ok" : "warn",
    detail: `${memoryGb(freeMemory)} free of ${memoryGb(totalMemory)}`,
  });

  const freeDisk = await freeDiskBytes(config.arcHome);
  const minimumDisk = options.minimumFreeDiskBytes ?? 10 * 1024 ** 3;
  checks.push({
    id: "disk",
    label: "Disk",
    status:
      freeDisk === null
        ? "warn"
        : freeDisk >= minimumDisk
          ? "ok"
          : "warn",
    detail:
      freeDisk === null
        ? "Could not read free disk space."
        : `${(freeDisk / 1024 ** 3).toFixed(1)} GB free`,
  });

  const failures = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  return {
    checks,
    ok: failures === 0,
    warnings,
  };
}

export function printDoctorReport(report: DoctorReport): void {
  console.log("\nARC doctor\n");
  for (const check of report.checks) {
    const marker =
      check.status === "ok" ? "OK" : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`  [${marker.padEnd(4)}] ${check.label}: ${check.detail}`);
  }
  const failures = report.checks.filter((check) => check.status === "fail").length;
  console.log(
    `\n${report.ok ? "ARC is ready." : `${failures} check(s) failed.`}${report.warnings > 0 ? ` ${report.warnings} warning(s).` : ""}\n`,
  );
}

async function pathCheck(
  id: string,
  label: string,
  directory: string,
  kind: "directory",
): Promise<DoctorCheck> {
  try {
    await mkdir(directory, { recursive: true });
    return {
      id,
      label,
      status: "ok",
      detail: `${kind} ${directory} is available.`,
    };
  } catch (error) {
    return {
      id,
      label,
      status: "fail",
      detail: `${directory} is not available: ${errorMessage(error)}`,
    };
  }
}

async function braveCheck(
  secretStore: SecretStorePort,
): Promise<DoctorCheck> {
  try {
    const key = await secretStore.get(SECRET_ACCOUNTS.braveApiKey);
    return {
      id: "brave",
      label: "Brave Search",
      status: key ? "ok" : "warn",
      detail: key
        ? "API key is present in the OS credential store."
        : "No API key. Set one with: arc secrets set brave.api-key",
    };
  } catch (error) {
    return {
      id: "brave",
      label: "Brave Search",
      status: "warn",
      detail: `Could not read the Brave API key: ${errorMessage(error)}`,
    };
  }
}

async function emailCheck(
  config: AppConfig,
  secretStore: SecretStorePort,
): Promise<DoctorCheck> {
  if (!config.email.enabled) {
    return {
      id: "email",
      label: "Gmail IMAP",
      status: "ok",
      detail: "Disabled. Set ARC_EMAIL_ENABLED=true to enable read-only polling.",
    };
  }
  try {
    const password = await secretStore.get(SECRET_ACCOUNTS.gmailAppPassword);
    return {
      id: "email",
      label: "Gmail IMAP",
      status: password && config.email.address ? "ok" : "warn",
      detail:
        password && config.email.address
          ? `Read-only polling configured for ${config.email.address}.`
          : `Missing ${config.email.address ? "gmail.app-password" : "ARC_EMAIL_ADDRESS"}.`,
    };
  } catch (error) {
    return {
      id: "email",
      label: "Gmail IMAP",
      status: "warn",
      detail: `Could not read the Gmail app password: ${errorMessage(error)}`,
    };
  }
}

async function telegramCheck(
  config: AppConfig,
  secretStore: SecretStorePort,
): Promise<DoctorCheck> {
  if (!config.telegram.enabled) {
    return {
      id: "telegram",
      label: "Telegram",
      status: "ok",
      detail: "Disabled. Set ARC_TELEGRAM_ENABLED=true to enable remote chat.",
    };
  }
  try {
    const token = await secretStore.get(SECRET_ACCOUNTS.telegramBotToken);
    const configured =
      Boolean(token) &&
      config.telegram.allowedChatIds.length > 0;
    return {
      id: "telegram",
      label: "Telegram",
      status: configured ? "ok" : "warn",
      detail: configured
        ? `Bot token present; ${config.telegram.allowedChatIds.length} allowed chat(s).`
        : "Missing bot token or allowed chat ids. Run: arc secrets set telegram.bot-token",
    };
  } catch (error) {
    return {
      id: "telegram",
      label: "Telegram",
      status: "warn",
      detail: `Could not read the Telegram bot token: ${errorMessage(error)}`,
    };
  }
}

async function ollamaCheck(
  config: AppConfig,
  fetchImpl: typeof fetch,
): Promise<DoctorCheck> {
  try {
    const response = await fetchImpl(`${config.ollama.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return {
        id: "ollama",
        label: "Ollama",
        status: "fail",
        detail: `HTTP ${response.status} from ${config.ollama.baseUrl}`,
      };
    }
    return {
      id: "ollama",
      label: "Ollama",
      status: "ok",
      detail: `Reachable at ${config.ollama.baseUrl}`,
    };
  } catch (error) {
    return {
      id: "ollama",
      label: "Ollama",
      status: "fail",
      detail: `Cannot reach ${config.ollama.baseUrl}: ${errorMessage(error)}`,
    };
  }
}

async function modelCheck(
  config: AppConfig,
  fetchImpl: typeof fetch,
): Promise<DoctorCheck> {
  try {
    const response = await fetchImpl(`${config.ollama.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return {
        id: "models",
        label: "Models",
        status: "fail",
        detail: "Could not list installed Ollama models.",
      };
    }
    const data = (await response.json()) as {
      models?: Array<{ name?: string }>;
    };
    const installed = new Set(
      (data.models ?? [])
        .map((model) => model.name)
        .filter((name): name is string => typeof name === "string"),
    );
    const required = [
      config.ollama.model,
      config.ollama.codingModel,
      config.ollama.researchModel,
      config.ollama.decisionModel,
    ];
    const missing = required.filter((name) => !hasModel(installed, name));
    return {
      id: "models",
      label: "Models",
      status: missing.length === 0 ? "ok" : "warn",
      detail:
        missing.length === 0
          ? `Installed: ${[...new Set(required)].join(", ")}`
          : `Missing: ${missing.join(", ")}. Pull with: ollama pull <model>`,
    };
  } catch (error) {
    return {
      id: "models",
      label: "Models",
      status: "warn",
      detail: `Could not inspect models: ${errorMessage(error)}`,
    };
  }
}

function hasModel(installed: Set<string>, wanted: string): boolean {
  const normalized = wanted.includes(":") ? wanted : `${wanted}:latest`;
  return [...installed].some((name) => {
    const candidate = name.includes(":") ? name : `${name}:latest`;
    return candidate === normalized || name.split(":")[0] === wanted;
  });
}

async function freeDiskBytes(directory: string): Promise<number | null> {
  try {
    const stats = await statfs(directory);
    return Number(stats.bsize) * Number(stats.bavail);
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
