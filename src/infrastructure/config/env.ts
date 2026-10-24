import "dotenv/config";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  loadModelSettings,
  modelSettingsPath,
  type ModelSettings,
} from "./models.js";

const optionalString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().min(1).optional(),
);
const optionalEmail = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().email().optional(),
);
const optionalBoolean = z.enum(["true", "false", "1", "0"]).optional();

const envSchema = z.object({
  // ARC-prefixed configuration is canonical. OLLAMA_*/legacy names remain
  // accepted so existing installations can migrate without losing state.
  ARC_OLLAMA_BASE_URL: optionalString,
  OLLAMA_BASE_URL: optionalString,
  ARC_MODEL_PROVIDER: optionalString,
  ARC_MODEL_MODE: z.enum(["local", "hybrid", "cloud"]).optional(),
  ARC_MODEL: optionalString,
  OLLAMA_MODEL: optionalString,
  ARC_CODING_MODEL: optionalString,
  ARC_RESEARCH_MODEL: optionalString,
  ARC_DECISION_MODEL: optionalString,
  ARC_DECISION_BASE_URL: optionalString,
  ARC_NUM_CTX: z.coerce.number().int().min(1024).max(32768).optional(),
  OLLAMA_NUM_CTX: z.coerce.number().int().min(1024).max(32768).optional(),
  ARC_NUM_PREDICT: z.coerce.number().int().min(128).max(8192).optional(),
  OLLAMA_NUM_PREDICT: z.coerce.number().int().min(128).max(8192).optional(),
  ARC_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),
  OLLAMA_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),
  ARC_TOP_P: z.coerce.number().min(0).max(1).optional(),
  OLLAMA_TOP_P: z.coerce.number().min(0).max(1).optional(),
  ARC_KEEP_ALIVE: optionalString,
  OLLAMA_KEEP_ALIVE: optionalString,
  ARC_TIMEOUT_MS: z.coerce.number().int().min(1000).optional(),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().min(1000).optional(),

  ARC_MAX_AGENT_STEPS: z.coerce.number().int().min(1).max(50).optional(),
  MAX_AGENT_STEPS: z.coerce.number().int().min(1).max(50).optional(),
  ARC_MAX_CONTEXT_MESSAGES: z.coerce.number().int().min(2).max(100).optional(),
  MAX_CONTEXT_MESSAGES: z.coerce.number().int().min(2).max(100).optional(),
  ARC_MAX_CONTEXT_CHARS: z.coerce.number().int().min(2000).optional(),
  MAX_CONTEXT_CHARS: z.coerce.number().int().min(2000).optional(),
  ARC_MAX_OBSERVATION_CHARS: z.coerce.number().int().min(200).optional(),
  MAX_OBSERVATION_CHARS: z.coerce.number().int().min(200).optional(),
  ARC_MAX_MEMORY_CHARS: z.coerce.number().int().min(500).optional(),
  MAX_MEMORY_CHARS: z.coerce.number().int().min(500).optional(),
  ARC_MAX_SKILL_INDEX_CHARS: z.coerce.number().int().min(200).optional(),
  MAX_SKILL_INDEX_CHARS: z.coerce.number().int().min(200).optional(),
  ARC_KEEP_RECENT_MESSAGES: z.coerce.number().int().min(2).max(50).optional(),
  KEEP_RECENT_MESSAGES: z.coerce.number().int().min(2).max(50).optional(),
  ARC_MEMORY_AUTO_CAPTURE: optionalBoolean,
  MEMORY_AUTO_CAPTURE: optionalBoolean,

  ARC_HOME: optionalString,
  AGENT_HOME: optionalString,
  ARC_PROFILE: optionalString,
  AGENT_PROFILE: optionalString,
  ARC_WORKSPACE: optionalString,
  WORKSPACE_DIR: optionalString,
  SANDBOX_DIR: optionalString,

  ARC_MAX_SUBAGENT_STEPS: z.coerce.number().int().min(1).max(30).optional(),
  MAX_SUBAGENT_STEPS: z.coerce.number().int().min(1).max(30).optional(),
  ARC_MAX_SUBAGENT_DEPTH: z.coerce.number().int().min(0).max(3).optional(),
  MAX_SUBAGENT_DEPTH: z.coerce.number().int().min(0).max(3).optional(),
  ARC_MAX_SUBAGENTS_PER_TURN: z.coerce.number().int().min(0).max(10).optional(),
  MAX_SUBAGENTS_PER_TURN: z.coerce.number().int().min(0).max(10).optional(),
  ARC_MAX_SUBAGENT_RUN_MS: z.coerce.number().int().min(10_000).optional(),
  MAX_SUBAGENT_RUN_MS: z.coerce.number().int().min(10_000).optional(),

  ARC_WEB_SEARCH_URL: optionalString,
  ARC_WEB_SEARCH_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).optional(),
  ARC_WEB_FETCH_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).optional(),
  ARC_WEB_MAX_BYTES: z.coerce.number().int().min(16_000).max(5_000_000).optional(),
  ARC_WEB_MAX_CHARS: z.coerce.number().int().min(1_000).max(100_000).optional(),
  ARC_WEB_MAX_REDIRECTS: z.coerce.number().int().min(0).max(5).optional(),
  ARC_WEB_CACHE_TTL_MS: z.coerce.number().int().min(0).max(3_600_000).optional(),
  ARC_WEB_MAX_RESULTS: z.coerce.number().int().min(1).max(10).optional(),
  ARC_SHELL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).optional(),
  ARC_SHELL_MAX_OUTPUT_BYTES: z.coerce.number().int().min(4_000).max(1_000_000).optional(),

  ARC_EMAIL_ENABLED: optionalBoolean,
  ARC_EMAIL_ADDRESS: optionalEmail,
  ARC_EMAIL_IMAP_HOST: optionalString,
  ARC_EMAIL_IMAP_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  ARC_EMAIL_MAILBOX: optionalString,
  ARC_EMAIL_POLL_INTERVAL_MS: z.coerce.number().int().min(60_000).max(3_600_000).optional(),
  ARC_EMAIL_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(30).optional(),
  ARC_EMAIL_MAX_MESSAGES: z.coerce.number().int().min(1).max(50).optional(),
  ARC_EMAIL_SNIPPET_CHARS: z.coerce.number().int().min(100).max(4_000).optional(),
  ARC_EMAIL_TRIAGE_THRESHOLD: z.coerce.number().min(0).max(1).optional(),
  ARC_EMAIL_NOTIFY_ON_TRIAGE_FAILURE: optionalBoolean,

  ARC_TELEGRAM_ENABLED: optionalBoolean,
  ARC_TELEGRAM_ALLOWED_CHAT_IDS: optionalString,
  ARC_TELEGRAM_NOTIFY_CHAT_ID: optionalString,
  ARC_TELEGRAM_POLL_TIMEOUT_SEC: z.coerce.number().int().min(5).max(50).optional(),
});

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  codingModel: string;
  researchModel: string;
  decisionModel: string;
  decisionBaseUrl: string;
  numCtx: number;
  numPredict: number;
  temperature: number;
  topP: number;
  keepAlive: string;
  timeoutMs: number;
}

export interface AppConfig {
  ollama: OllamaConfig;
  /** Provider-neutral routing loaded from ARC_HOME/models.json. */
  models: ModelSettings;
  modelSettingsPath: string;
  agent: {
    defaultProfileId: string;
    maxSteps: number;
    maxContextMessages: number;
    maxContextChars: number;
    maxObservationChars: number;
    maxMemoryChars: number;
    maxSkillIndexChars: number;
    keepRecentMessages: number;
    memoryAutoCapture: boolean;
    compactAtChars: number;
  };
  subAgents: {
    maxSteps: number;
    maxDepth: number;
    maxPerTurn: number;
    maxRunMs: number;
  };
  web: {
    searchUrl: string;
    searchTimeoutMs: number;
    fetchTimeoutMs: number;
    maxBytes: number;
    maxChars: number;
    maxRedirects: number;
    cacheTtlMs: number;
    maxResults: number;
  };
  shell: {
    timeoutMs: number;
    maxOutputBytes: number;
  };
  email: {
    enabled: boolean;
    address: string;
    imapHost: string;
    imapPort: number;
    mailbox: string;
    pollIntervalMs: number;
    lookbackDays: number;
    maxMessages: number;
    snippetChars: number;
    triageThreshold: number;
    notifyOnTriageFailure: boolean;
  };
  telegram: {
    enabled: boolean;
    allowedChatIds: string[];
    notifyChatId?: string;
    pollTimeoutSec: number;
  };
  /** Private ARC state: memory, skills, profiles, sessions, audit. */
  arcHome: string;
  /** The filesystem workspace exposed to file tools. */
  workspaceDir: string;
  /** Backwards-compatible alias for workspaceDir. */
  sandboxDir: string;
  sessionDir: string;
  runDir: string;
  memoryDir: string;
  skillsDir: string;
  agentsDir: string;
  builtinSkillsDir: string;
  auditLogPath: string;
  standingOrdersPath: string;
}

export function loadConfig(raw: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const env = parsed.data;
  const baseUrl =
    env.ARC_OLLAMA_BASE_URL ??
    env.OLLAMA_BASE_URL ??
    "http://127.0.0.1:11434";
  const mainModel = env.ARC_MODEL ?? env.OLLAMA_MODEL ?? "qwen3:8b";
  const codingModel = env.ARC_CODING_MODEL ?? "qwen2.5-coder:7b";
  const researchModel = env.ARC_RESEARCH_MODEL ?? mainModel;
  const decisionModel = env.ARC_DECISION_MODEL ?? "tev1:0.8b";
  const arcHome = path.resolve(
    env.ARC_HOME ?? env.AGENT_HOME ?? defaultArcHome(),
  );
  const workspaceDir = path.resolve(
    env.ARC_WORKSPACE ?? env.WORKSPACE_DIR ?? env.SANDBOX_DIR ?? "./sandbox",
  );
  const loadedModels = loadModelSettings({
    arcHome,
    env: raw,
    legacy: {
      ollamaBaseUrl: baseUrl,
      main: mainModel,
      research: researchModel,
      coding: codingModel,
      decision: decisionModel,
    },
  });
  const models = env.ARC_MODEL_MODE
    ? { ...loadedModels, mode: env.ARC_MODEL_MODE }
    : loadedModels;
  const emailEnabled = booleanValue(env.ARC_EMAIL_ENABLED, false);
  const emailAddress = env.ARC_EMAIL_ADDRESS ?? "";
  if (emailEnabled && !emailAddress) {
    throw new Error(
      "ARC_EMAIL_ADDRESS is required when ARC_EMAIL_ENABLED=true.",
    );
  }
  const telegramEnabled = booleanValue(env.ARC_TELEGRAM_ENABLED, false);
  const allowedChatIds = parseChatIds(
    env.ARC_TELEGRAM_ALLOWED_CHAT_IDS ?? "",
  );
  if (telegramEnabled && allowedChatIds.length === 0) {
    throw new Error(
      "ARC_TELEGRAM_ALLOWED_CHAT_IDS must contain at least one chat id when ARC_TELEGRAM_ENABLED=true.",
    );
  }
  const notifyChatId = env.ARC_TELEGRAM_NOTIFY_CHAT_ID?.trim() || undefined;
  if (
    notifyChatId &&
    allowedChatIds.length > 0 &&
    !allowedChatIds.includes(notifyChatId)
  ) {
    throw new Error(
      "ARC_TELEGRAM_NOTIFY_CHAT_ID must be one of ARC_TELEGRAM_ALLOWED_CHAT_IDS.",
    );
  }
  const effectiveNotifyChatId = notifyChatId ?? allowedChatIds[0];

  if (
    samePath(arcHome, workspaceDir) ||
    isInsidePath(arcHome, workspaceDir)
  ) {
    throw new Error(
      "ARC_HOME must be outside ARC_WORKSPACE. Private memory, sessions, and audit logs cannot live inside the filesystem workspace.",
    );
  }

  return {
    ollama: {
      baseUrl,
      model: mainModel,
      codingModel,
      researchModel,
      decisionModel,
      decisionBaseUrl: env.ARC_DECISION_BASE_URL ?? baseUrl,
      numCtx: env.ARC_NUM_CTX ?? env.OLLAMA_NUM_CTX ?? 8192,
      numPredict: env.ARC_NUM_PREDICT ?? env.OLLAMA_NUM_PREDICT ?? 1024,
      temperature: env.ARC_TEMPERATURE ?? env.OLLAMA_TEMPERATURE ?? 0.2,
      topP: env.ARC_TOP_P ?? env.OLLAMA_TOP_P ?? 0.9,
      keepAlive: env.ARC_KEEP_ALIVE ?? env.OLLAMA_KEEP_ALIVE ?? "10m",
      timeoutMs: env.ARC_TIMEOUT_MS ?? env.OLLAMA_TIMEOUT_MS ?? 180_000,
    },
    agent: {
      defaultProfileId: env.ARC_PROFILE ?? env.AGENT_PROFILE ?? "arc",
      maxSteps: env.ARC_MAX_AGENT_STEPS ?? env.MAX_AGENT_STEPS ?? 12,
      maxContextMessages:
        env.ARC_MAX_CONTEXT_MESSAGES ?? env.MAX_CONTEXT_MESSAGES ?? 16,
      maxContextChars:
        env.ARC_MAX_CONTEXT_CHARS ?? env.MAX_CONTEXT_CHARS ?? 16_000,
      maxObservationChars:
        env.ARC_MAX_OBSERVATION_CHARS ?? env.MAX_OBSERVATION_CHARS ?? 4_000,
      maxMemoryChars: env.ARC_MAX_MEMORY_CHARS ?? env.MAX_MEMORY_CHARS ?? 6_000,
      maxSkillIndexChars:
        env.ARC_MAX_SKILL_INDEX_CHARS ?? env.MAX_SKILL_INDEX_CHARS ?? 2_500,
      keepRecentMessages:
        env.ARC_KEEP_RECENT_MESSAGES ?? env.KEEP_RECENT_MESSAGES ?? 8,
      memoryAutoCapture: booleanValue(
        env.ARC_MEMORY_AUTO_CAPTURE ?? env.MEMORY_AUTO_CAPTURE,
        true,
      ),
      compactAtChars:
        (env.ARC_MAX_CONTEXT_CHARS ?? env.MAX_CONTEXT_CHARS ?? 16_000) * 0.7,
    },
    subAgents: {
      maxSteps: env.ARC_MAX_SUBAGENT_STEPS ?? env.MAX_SUBAGENT_STEPS ?? 8,
      maxDepth: env.ARC_MAX_SUBAGENT_DEPTH ?? env.MAX_SUBAGENT_DEPTH ?? 1,
      maxPerTurn:
        env.ARC_MAX_SUBAGENTS_PER_TURN ?? env.MAX_SUBAGENTS_PER_TURN ?? 2,
      maxRunMs:
        env.ARC_MAX_SUBAGENT_RUN_MS ?? env.MAX_SUBAGENT_RUN_MS ?? 300_000,
    },
    web: {
      searchUrl:
        env.ARC_WEB_SEARCH_URL ??
        "https://api.search.brave.com/res/v1/web/search",
      searchTimeoutMs: env.ARC_WEB_SEARCH_TIMEOUT_MS ?? 15_000,
      fetchTimeoutMs: env.ARC_WEB_FETCH_TIMEOUT_MS ?? 20_000,
      maxBytes: env.ARC_WEB_MAX_BYTES ?? 512 * 1024,
      maxChars: env.ARC_WEB_MAX_CHARS ?? 20_000,
      maxRedirects: env.ARC_WEB_MAX_REDIRECTS ?? 3,
      cacheTtlMs: env.ARC_WEB_CACHE_TTL_MS ?? 5 * 60_000,
      maxResults: env.ARC_WEB_MAX_RESULTS ?? 8,
    },
    shell: {
      timeoutMs: env.ARC_SHELL_TIMEOUT_MS ?? 60_000,
      maxOutputBytes: env.ARC_SHELL_MAX_OUTPUT_BYTES ?? 64 * 1024,
    },
    email: {
      enabled: emailEnabled,
      address: emailAddress,
      imapHost: env.ARC_EMAIL_IMAP_HOST ?? "imap.gmail.com",
      imapPort: env.ARC_EMAIL_IMAP_PORT ?? 993,
      mailbox: env.ARC_EMAIL_MAILBOX ?? "INBOX",
      pollIntervalMs: env.ARC_EMAIL_POLL_INTERVAL_MS ?? 5 * 60_000,
      lookbackDays: env.ARC_EMAIL_LOOKBACK_DAYS ?? 2,
      maxMessages: env.ARC_EMAIL_MAX_MESSAGES ?? 10,
      snippetChars: env.ARC_EMAIL_SNIPPET_CHARS ?? 800,
      triageThreshold: env.ARC_EMAIL_TRIAGE_THRESHOLD ?? 0.65,
      notifyOnTriageFailure: booleanValue(
        env.ARC_EMAIL_NOTIFY_ON_TRIAGE_FAILURE,
        true,
      ),
    },
    telegram: {
      enabled: telegramEnabled,
      allowedChatIds,
      ...(effectiveNotifyChatId
        ? { notifyChatId: effectiveNotifyChatId }
        : {}),
      pollTimeoutSec: env.ARC_TELEGRAM_POLL_TIMEOUT_SEC ?? 30,
    },
    models,
    modelSettingsPath: modelSettingsPath(arcHome),
    arcHome,
    workspaceDir,
    sandboxDir: workspaceDir,
    sessionDir: path.join(arcHome, "sessions"),
    runDir: path.join(arcHome, "runs"),
    memoryDir: path.join(arcHome, "memory"),
    skillsDir: path.join(arcHome, "skills"),
    agentsDir: path.join(arcHome, "agents"),
    builtinSkillsDir: path.join(packageRoot(), "skills"),
    auditLogPath: path.join(arcHome, "audit.jsonl"),
    standingOrdersPath: path.join(arcHome, "STANDING_ORDERS.md"),
  };
}

function defaultArcHome(): string {
  const home = os.homedir();
  if (process.platform === "win32") {
    const base =
      process.env.LOCALAPPDATA ??
      process.env.APPDATA ??
      path.join(home, "AppData", "Local");
    return path.join(base, "ARC", "agent-home");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "ARC", "agent-home");
  }
  const stateHome =
    process.env.XDG_STATE_HOME ?? path.join(home, ".local", "state");
  return path.join(stateHome, "arc", "agent-home");
}

/**
 * Built-in skills ship next to the installed package, not next to the user's
 * current project. This keeps `arc` working when launched from any folder.
 */
function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

function parseChatIds(value: string): string[] {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const invalid = entries.filter((entry) => !/^-?\d+$/.test(entry));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid Telegram chat id(s): ${invalid.join(", ")}. Use numeric ids separated by commas.`,
    );
  }
  return [...new Set(entries)];
}

function booleanValue(
  value: "true" | "false" | "1" | "0" | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === "true" || value === "1";
}

function samePath(left: string, right: string): boolean {
  return normalizeForComparison(left) === normalizeForComparison(right);
}

function isInsidePath(candidate: string, parent: string): boolean {
  const normalizedCandidate = normalizeForComparison(candidate);
  const normalizedParent = normalizeForComparison(parent);
  return normalizedCandidate.startsWith(
    normalizedParent.endsWith(path.sep)
      ? normalizedParent
      : `${normalizedParent}${path.sep}`,
  );
}

function normalizeForComparison(value: string): string {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
