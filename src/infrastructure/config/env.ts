import "dotenv/config";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().min(1).default("qwen3:8b"),
  OLLAMA_NUM_CTX: z.coerce.number().int().min(1024).max(32768).default(8192),
  OLLAMA_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  OLLAMA_TOP_P: z.coerce.number().min(0).max(1).default(0.9),
  OLLAMA_KEEP_ALIVE: z.string().min(1).default("10m"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().min(1000).default(180_000),
  MAX_AGENT_STEPS: z.coerce.number().int().min(1).max(50).default(12),
  MAX_CONTEXT_MESSAGES: z.coerce.number().int().min(2).max(100).default(16),
  MAX_CONTEXT_CHARS: z.coerce.number().int().min(2000).default(16_000),
  MAX_OBSERVATION_CHARS: z.coerce.number().int().min(200).default(4_000),
  SANDBOX_DIR: z.string().min(1).default("./sandbox"),
});

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  numCtx: number;
  temperature: number;
  topP: number;
  keepAlive: string;
  timeoutMs: number;
}

export interface AppConfig {
  ollama: OllamaConfig;
  agent: {
    maxSteps: number;
    maxContextMessages: number;
    maxContextChars: number;
    maxObservationChars: number;
  };
  sandboxDir: string;
  sessionDir: string;
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
  const sandboxDir = path.resolve(env.SANDBOX_DIR);

  return {
    ollama: {
      baseUrl: env.OLLAMA_BASE_URL,
      model: env.OLLAMA_MODEL,
      numCtx: env.OLLAMA_NUM_CTX,
      temperature: env.OLLAMA_TEMPERATURE,
      topP: env.OLLAMA_TOP_P,
      keepAlive: env.OLLAMA_KEEP_ALIVE,
      timeoutMs: env.OLLAMA_TIMEOUT_MS,
    },
    agent: {
      maxSteps: env.MAX_AGENT_STEPS,
      maxContextMessages: env.MAX_CONTEXT_MESSAGES,
      maxContextChars: env.MAX_CONTEXT_CHARS,
      maxObservationChars: env.MAX_OBSERVATION_CHARS,
    },
    sandboxDir,
    sessionDir: path.join(sandboxDir, ".agent", "sessions"),
  };
}
