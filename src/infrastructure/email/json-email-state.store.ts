import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { EmailSourceError } from "../../domain/errors/agent.errors.js";
import type {
  EmailStateStorePort,
  EmailWatchState,
} from "../../domain/ports/email.port.js";

const stateSchema = z.object({
  uidValidity: z.string().min(1),
  lastNotifiedUid: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
});

/**
 * Small JSON state file in ARC_HOME. It stores only UIDVALIDITY and the last
 * UID ARC processed, never a message body or address.
 */
export class JsonEmailStateStore implements EmailStateStorePort {
  constructor(private readonly filePath: string) {}

  async load(): Promise<EmailWatchState | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw new EmailSourceError(
        `Could not read email state at ${this.filePath}: ${errorMessage(error)}`,
        { cause: error },
      );
    }

    try {
      return stateSchema.parse(JSON.parse(raw));
    } catch (error) {
      throw new EmailSourceError(
        `Email state at ${this.filePath} is invalid: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  async save(state: EmailWatchState): Promise<void> {
    const directory = path.dirname(this.filePath);
    const temporary = `${this.filePath}.tmp-${process.pid}`;
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporary, this.filePath);
  }
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
