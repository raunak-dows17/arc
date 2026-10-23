import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  SubAgentRun,
  type SubAgentRunProps,
} from "../../domain/entities/sub-agent-run.js";
import { SubAgentError } from "../../domain/errors/agent.errors.js";
import type { SubAgentRepositoryPort } from "../../domain/ports/sub-agent-repository.port.js";

const SAFE_ID = /^[A-Za-z0-9._-]+$/;

const usageSchema = z.object({
  modelCalls: z.number().int().nonnegative().default(0),
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  totalDurationMs: z.number().int().nonnegative().default(0),
});

const runSchema = z.object({
  id: z.string().min(1),
  parentSessionId: z.string().min(1),
  childSessionId: z.string().min(1),
  parentAgentId: z.string().min(1),
  agentId: z.string().min(1),
  task: z.string(),
  depth: z.number().int().nonnegative(),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  createdAt: z.string().min(1),
  finishedAt: z.string().nullable(),
  summary: z.string(),
  error: z.string().nullable(),
  steps: z.number().int().nonnegative(),
  usage: usageSchema,
});

/** Atomic JSON storage for sub-agent run records under AGENT_HOME/runs. */
export class JsonSubAgentRepository implements SubAgentRepositoryPort {
  constructor(private readonly directory: string) {}

  async save(run: SubAgentRun): Promise<void> {
    this.assertSafeId(run.id);
    await mkdir(this.directory, { recursive: true });
    const file = this.fileFor(run.id);
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temp, `${JSON.stringify(run.toProps(), null, 2)}\n`, "utf8");
      await rename(temp, file);
    } catch (error) {
      throw new SubAgentError(`Could not save sub-agent run "${run.id}".`, {
        cause: error,
      });
    }
  }

  async load(id: string): Promise<SubAgentRun | null> {
    this.assertSafeId(id);
    try {
      const text = await readFile(this.fileFor(id), "utf8");
      const parsed = runSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        throw new SubAgentError(`Run "${id}" has an unexpected shape.`);
      }
      return SubAgentRun.restore(parsed.data as SubAgentRunProps);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      if (error instanceof SubAgentError) {
        throw error;
      }
      throw new SubAgentError(`Could not read sub-agent run "${id}".`, {
        cause: error,
      });
    }
  }

  async list(limit = 20): Promise<SubAgentRun[]> {
    const runs = await this.loadAll();
    return runs.slice(0, Math.max(1, limit));
  }

  async listByParent(
    parentSessionId: string,
    limit = 20,
  ): Promise<SubAgentRun[]> {
    const runs = (await this.loadAll()).filter(
      (run) => run.parentSessionId === parentSessionId,
    );
    return runs.slice(0, Math.max(1, limit));
  }

  private async loadAll(): Promise<SubAgentRun[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw new SubAgentError("Could not list sub-agent runs.", {
        cause: error,
      });
    }

    const runs: SubAgentRun[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) {
        continue;
      }
      try {
        const run = await this.load(name.slice(0, -5));
        if (run) {
          runs.push(run);
        }
      } catch {
        // Ignore corrupt records in the listing.
      }
    }

    return runs.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }

  private fileFor(id: string): string {
    return path.join(this.directory, `${id}.json`);
  }

  private assertSafeId(id: string): void {
    if (!SAFE_ID.test(id)) {
      throw new SubAgentError(`Invalid sub-agent run id: "${id}".`);
    }
  }
}
