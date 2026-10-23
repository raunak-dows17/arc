import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  AgentSession,
  emptySessionUsage,
  type AgentSessionProps,
} from "../../domain/entities/agent-session.js";
import { SessionStoreError } from "../../domain/errors/agent.errors.js";
import type {
  SessionStorePort,
  SessionSummary,
} from "../../domain/ports/session-store.port.js";

const SAFE_SESSION_ID = /^[A-Za-z0-9._-]+$/;

const usageSchema = z.object({
  modelCalls: z.number().int().nonnegative().default(0),
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  totalDurationMs: z.number().int().nonnegative().default(0),
});

const summarySchema = z.object({
  text: z.string(),
  throughMessageCount: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
});

/**
 * Schema v2. All new fields are optional so transcripts written by v1 still
 * load and receive safe defaults.
 */
const sessionFileSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  status: z.enum(["active", "completed", "failed"]),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "tool"]),
      content: z.string(),
      toolName: z.string().optional(),
      at: z.string().min(1),
    }),
  ),
  agentId: z.string().min(1).optional(),
  parentId: z.string().min(1).nullable().optional(),
  depth: z.number().int().nonnegative().optional(),
  summary: summarySchema.nullable().optional(),
  usage: usageSchema.optional(),
});

/**
 * JSON transcript storage inside AGENT_HOME/sessions. Writes are atomic
 * (temp file + rename).
 */
export class JsonSessionStore implements SessionStorePort {
  constructor(private readonly directory: string) {}

  async save(session: AgentSession): Promise<void> {
    this.assertSafeId(session.id);
    await mkdir(this.directory, { recursive: true });

    const file = this.fileFor(session.id);
    const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
    const serialized = `${JSON.stringify(session.toProps(), null, 2)}\n`;

    try {
      await writeFile(tempFile, serialized, "utf8");
      await rename(tempFile, file);
    } catch (error) {
      throw new SessionStoreError(
        `Could not save session "${session.id}".`,
        { cause: error },
      );
    }
  }

  async load(id: string): Promise<AgentSession | null> {
    this.assertSafeId(id);

    let text: string;
    try {
      text = await readFile(this.fileFor(id), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw new SessionStoreError(`Could not read session "${id}".`, {
        cause: error,
      });
    }

    return this.parseSession(text, id);
  }

  async latest(): Promise<AgentSession | null> {
    const files = await this.sessionFiles();
    if (files.length === 0) {
      return null;
    }

    const withStats = await Promise.all(
      files.map(async (file) => ({
        file,
        modifiedAt: (await stat(file)).mtimeMs,
      })),
    );
    withStats.sort((left, right) => right.modifiedAt - left.modifiedAt);

    for (const { file } of withStats) {
      const id = path.basename(file, ".json");
      try {
        const session = await this.load(id);
        // Sub-agent transcripts are resumable by id, but the default `resume`
        // should always return the user's root conversation.
        if (session && session.parentId === null) {
          return session;
        }
      } catch {
        // Skip unreadable/corrupt transcripts and fall back to the next one.
      }
    }
    return null;
  }

  async list(): Promise<SessionSummary[]> {
    const files = await this.sessionFiles();
    const summaries: SessionSummary[] = [];

    for (const file of files) {
      const id = path.basename(file, ".json");
      try {
        const session = await this.load(id);
        if (session) {
          summaries.push({
            id: session.id,
            updatedAt: session.updatedAt,
            messageCount: session.messages.length,
            status: session.status,
            agentId: session.agentId,
            parentId: session.parentId,
          });
        }
      } catch {
        // Ignore corrupt files in the listing.
      }
    }

    return summaries.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  private async parseSession(
    text: string,
    id: string,
  ): Promise<AgentSession> {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new SessionStoreError(
        `Session file for "${id}" is not valid JSON.`,
        { cause: error },
      );
    }

    const parsed = sessionFileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new SessionStoreError(
        `Session file for "${id}" has an unexpected shape.`,
      );
    }

    const data = parsed.data;
    const props: AgentSessionProps = {
      id: data.id,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      status: data.status,
      messages: data.messages.map((message) => ({
        role: message.role,
        content: message.content,
        at: message.at,
        ...(message.toolName !== undefined ? { toolName: message.toolName } : {}),
      })),
      agentId: data.agentId ?? "assistant",
      parentId: data.parentId ?? null,
      depth: data.depth ?? 0,
      summary: data.summary
        ? {
            text: data.summary.text,
            throughMessageCount: data.summary.throughMessageCount,
            updatedAt: data.summary.updatedAt,
          }
        : null,
      usage: data.usage ?? emptySessionUsage(),
    };
    return AgentSession.restore(props);
  }

  private async sessionFiles(): Promise<string[]> {
    try {
      const names = await readdir(this.directory);
      return names
        .filter((name) => name.endsWith(".json"))
        .map((name) => path.join(this.directory, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw new SessionStoreError("Could not list saved sessions.", {
        cause: error,
      });
    }
  }

  private fileFor(id: string): string {
    return path.join(this.directory, `${id}.json`);
  }

  private assertSafeId(id: string): void {
    if (!SAFE_SESSION_ID.test(id)) {
      throw new SessionStoreError(`Invalid session id: "${id}".`);
    }
  }
}
