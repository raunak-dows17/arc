import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { TelegramError } from "../../domain/errors/agent.errors.js";

const offsetSchema = z.object({
  offset: z.number().int().nonnegative(),
});

const sessionsSchema = z.object({
  sessions: z.record(z.string(), z.string()),
});

export class JsonTelegramOffsetStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<number> {
    const raw = await readOptional(this.filePath);
    if (raw === null) {
      return 0;
    }
    try {
      return offsetSchema.parse(JSON.parse(raw)).offset;
    } catch (error) {
      throw new TelegramError(
        `Telegram offset state at ${this.filePath} is invalid: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  async save(offset: number): Promise<void> {
    await writeAtomic(
      this.filePath,
      `${JSON.stringify({ offset: Math.max(0, Math.floor(offset)) }, null, 2)}\n`,
    );
  }
}

export class JsonTelegramSessionStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<Record<string, string>> {
    const raw = await readOptional(this.filePath);
    if (raw === null) {
      return {};
    }
    try {
      return sessionsSchema.parse(JSON.parse(raw)).sessions;
    } catch (error) {
      throw new TelegramError(
        `Telegram session state at ${this.filePath} is invalid: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  async save(sessions: Record<string, string>): Promise<void> {
    await writeAtomic(
      this.filePath,
      `${JSON.stringify({ sessions }, null, 2)}\n`,
    );
  }
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw new TelegramError(
      `Could not read Telegram state at ${filePath}: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, filePath);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
