import pino from "pino";
import { env } from "../config/env.js";

const isDevelopment = env.NODE_ENV === "development";

export const logger = pino({
  level: env.LOG_LEVEL,
  ...(isDevelopment
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            ignore: "pid, hostname",
            translateTime: "SYS:standard",
          },
        },
      }
    : {}),
});

export const agentLogger = {
  info: (message: string, meta?: Record<string, any>) =>
    logger.info({ ...meta, context: "AgentRuntime" }, message),
  warn: (message: string, meta?: Record<string, any>) =>
    logger.warn({ ...meta, context: "AgentRuntime" }, message),
  debug: (message: string, meta?: Record<string, any>) =>
    logger.debug({ ...meta, context: "AgentRuntime" }, message),
  error: (message: string, error?: Error, meta?: Record<string, any>) =>
    logger.error({ err: error, ...meta, context: "AgentRuntime" }, message),
  step: (stepNumber: number, thought: string) =>
    logger.info(
      { context: "AgentLoop", step: stepNumber },
      `🧠 [Thought Process]: ${thought}`,
    ),
};
