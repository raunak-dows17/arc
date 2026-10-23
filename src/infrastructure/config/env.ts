import "dotenv/config";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().min(1).default("qwen3:8b"),
  OLLAMA_NUM_CTX: z.coerce.number().int().min(1024).max(32768).default(8192),
  OLLAMA_NUM_PREDICT: z.coerce.number().int().min(128).max(8192).default(1024),
  OLLAMA_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  OLLAMA_TOP_P: z.coerce.number().min(0).max(1).default(0.9),
  OLLAMA_KEEP_ALIVE: z.string().min(1).default("10m"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().min(1000).default(180_000),
  MAX_AGENT_STEPS: z.coerce.number().int().min(1).max(50).default(12),
  MAX_CONTEXT_MESSAGES: z.coerce.number().int().min(2).max(100).default(16),
  MAX_CONTEXT_CHARS: z.coerce.number().int().min(2000).default(16_000),
  MAX_OBSERVATION_CHARS: z.coerce.number().int().min(200).default(4_000),
  MAX_MEMORY_CHARS: z.coerce.number().int().min(500).default(6_000),
  MAX_SKILL_INDEX_CHARS: z.coerce.number().int().min(200).default(2_500),
  KEEP_RECENT_MESSAGES: z.coerce.number().int().min(2).max(50).default(8),
  MEMORY_AUTO_CAPTURE: z
    .enum(["true", "false", "1", "0"])
    .default("true")
    .transform((value) => value === "true" || value === "1"),
  AGENT_HOME: z.string().min(1).default("./.agent-home"),
  AGENT_PROFILE: z.string().min(1).default("assistant"),
  WORKSPACE_DIR: z.string().min(1).optional(),
  SANDBOX_DIR: z.string().min(1).optional(),
  MAX_SUBAGENT_STEPS: z.coerce.number().int().min(1).max(30).default(8),
  MAX_SUBAGENT_DEPTH: z.coerce.number().int().min(0).max(3).default(1),
  MAX_SUBAGENTS_PER_TURN: z.coerce.number().int().min(0).max(10).default(2),
  MAX_SUBAGENT_RUN_MS: z.coerce.number().int().min(10_000).default(300_000),
});

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  numCtx: number;
  numPredict: number;
  temperature: number;
  topP: number;
  keepAlive: string;
  timeoutMs: number;
}

export interface AppConfig {
  ollama: OllamaConfig;
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
  /** Private agent state: memory, skills, profiles, sessions, audit. */
  agentHome: string;
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
  const agentHome = path.resolve(env.AGENT_HOME);
  const workspaceDir = path.resolve(
    env.WORKSPACE_DIR ?? env.SANDBOX_DIR ?? "./sandbox",
  );

  if (
    agentHome === workspaceDir ||
    agentHome.startsWith(`${workspaceDir}${path.sep}`)
  ) {
    throw new Error(
      "AGENT_HOME must be outside WORKSPACE_DIR. Private memory, sessions, and audit logs cannot live inside the filesystem workspace.",
    );
  }

  return {
    ollama: {
      baseUrl: env.OLLAMA_BASE_URL,
      model: env.OLLAMA_MODEL,
      numCtx: env.OLLAMA_NUM_CTX,
      numPredict: env.OLLAMA_NUM_PREDICT,
      temperature: env.OLLAMA_TEMPERATURE,
      topP: env.OLLAMA_TOP_P,
      keepAlive: env.OLLAMA_KEEP_ALIVE,
      timeoutMs: env.OLLAMA_TIMEOUT_MS,
    },
    agent: {
      defaultProfileId: env.AGENT_PROFILE,
      maxSteps: env.MAX_AGENT_STEPS,
      maxContextMessages: env.MAX_CONTEXT_MESSAGES,
      maxContextChars: env.MAX_CONTEXT_CHARS,
      maxObservationChars: env.MAX_OBSERVATION_CHARS,
      maxMemoryChars: env.MAX_MEMORY_CHARS,
      maxSkillIndexChars: env.MAX_SKILL_INDEX_CHARS,
      keepRecentMessages: env.KEEP_RECENT_MESSAGES,
      memoryAutoCapture: env.MEMORY_AUTO_CAPTURE,
      compactAtChars: Math.floor(env.MAX_CONTEXT_CHARS * 0.7),
    },
    subAgents: {
      maxSteps: env.MAX_SUBAGENT_STEPS,
      maxDepth: env.MAX_SUBAGENT_DEPTH,
      maxPerTurn: env.MAX_SUBAGENTS_PER_TURN,
      maxRunMs: env.MAX_SUBAGENT_RUN_MS,
    },
    agentHome,
    workspaceDir,
    sandboxDir: workspaceDir,
    sessionDir: path.join(agentHome, "sessions"),
    runDir: path.join(agentHome, "runs"),
    memoryDir: path.join(agentHome, "memory"),
    skillsDir: path.join(agentHome, "skills"),
    agentsDir: path.join(agentHome, "agents"),
    builtinSkillsDir: path.resolve("skills"),
    auditLogPath: path.join(agentHome, "audit.jsonl"),
    standingOrdersPath: path.join(agentHome, "STANDING_ORDERS.md"),
  };
}
