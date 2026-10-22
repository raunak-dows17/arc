import pino from "pino";
import { env } from "../config/env.js";

const isDevelopment = env.NODE_ENV === "development";
let interactiveTerminal = false;

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
    log("info", message, meta),
  warn: (message: string, meta?: Record<string, any>) =>
    log("warn", message, meta),
  debug: (message: string, meta?: Record<string, any>) =>
    log("debug", message, meta),
  error: (message: string, error?: Error, meta?: Record<string, any>) =>
    log("error", message, { err: error, ...meta }),
  step: (stepNumber: number, thought: string) => {
    if (!interactiveTerminal) {
      logger.info(
        { context: "AgentLoop", step: stepNumber },
        `🧠 [Thought Process]: ${thought}`,
      );
    }
  },
  setInteractiveTerminal: (enabled: boolean) => {
    interactiveTerminal = enabled;
  },
};

function log(
  level: "info" | "warn" | "debug" | "error",
  message: string,
  meta?: Record<string, any>,
): void {
  if (interactiveTerminal) {
    return;
  }
  logger[level]({ ...meta, context: "AgentRuntime" }, message);
}
