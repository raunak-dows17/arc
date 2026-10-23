import { appendFile, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import MiniSearch from "minisearch";
import { MemoryStoreError } from "../../domain/errors/agent.errors.js";
import type {
  MemoryCore,
  MemoryScope,
  MemorySearchResult,
  MemoryStorePort,
} from "../../domain/ports/memory-store.port.js";

interface MemoryDocument {
  id: string;
  title: string;
  content: string;
  path: string;
}

const DEFAULT_USER = [
  "# User",
  "",
  "<!-- Stable preferences and facts about the user. -->",
  "",
].join("\n");

const DEFAULT_MEMORY = [
  "# Long-term memory",
  "",
  "<!-- Durable notes. Keep entries short and dated. -->",
  "",
].join("\n");

/**
 * Markdown memory store. Retrieval is keyword-based (MiniSearch) rather than
 * embedding-based, which keeps the 16 GB memory budget for the model itself.
 */
export class FileMemoryStore implements MemoryStorePort {
  private initializing: Promise<void> | null = null;
  private realRoot: string | null = null;

  constructor(private readonly root: string) {}

  async initialize(): Promise<void> {
    if (!this.initializing) {
      this.initializing = this.doInitialize();
    }
    await this.initializing;
  }

  async readCore(now: Date = new Date()): Promise<MemoryCore> {
    await this.initialize();
    const today = dateKey(now);
    const yesterday = dateKey(addDays(now, -1));

    const [user, longTerm, todayNotes, yesterdayNotes] = await Promise.all([
      this.readOptional(path.join(this.root, "USER.md")),
      this.readOptional(path.join(this.root, "MEMORY.md")),
      this.readOptional(path.join(this.root, "daily", `${today}.md`)),
      this.readOptional(path.join(this.root, "daily", `${yesterday}.md`)),
    ]);

    const recent = [yesterdayNotes?.trim(), todayNotes?.trim()]
      .filter((text): text is string => Boolean(text))
      .join("\n\n");

    return {
      user: (user ?? "").trim(),
      longTerm: (longTerm ?? "").trim(),
      recentDaily: recent.trim(),
    };
  }

  async appendDaily(
    entry: string,
    now: Date = new Date(),
  ): Promise<{ path: string; bytes: number }> {
    await this.initialize();
    const day = dateKey(now);
    const relativePath = `daily/${day}.md`;
    const file = path.join(this.root, relativePath);
    const existing = await this.readOptional(file);
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const line = `- ${time} — ${entry.trim().replace(/\n+/g, " / ")}\n`;

    if (!existing) {
      const header = `# ${day}\n\n`;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${header}${line}`, "utf8");
      return { path: relativePath, bytes: Buffer.byteLength(header + line, "utf8") };
    }

    const separator = existing.endsWith("\n") ? "" : "\n";
    const appended = `${separator}${line}`;
    await appendFile(file, appended, "utf8");
    return { path: relativePath, bytes: Buffer.byteLength(appended, "utf8") };
  }

  async remember(
    content: string,
    scope: MemoryScope,
    now: Date = new Date(),
  ): Promise<{ path: string; bytes: number }> {
    if (scope === "daily") {
      return this.appendDaily(content, now);
    }

    await this.initialize();
    const file = path.join(this.root, "MEMORY.md");
    const existing = await this.readOptional(file);
    const line = `- ${dateKey(now)} — ${content.trim().replace(/\n+/g, " / ")}\n`;

    if (!existing) {
      await writeFile(file, `${DEFAULT_MEMORY}\n${line}`, "utf8");
      return {
        path: "MEMORY.md",
        bytes: Buffer.byteLength(`${DEFAULT_MEMORY}\n${line}`, "utf8"),
      };
    }

    const separator = existing.endsWith("\n") ? "" : "\n";
    const appended = `${separator}${line}`;
    await appendFile(file, appended, "utf8");
    return { path: "MEMORY.md", bytes: Buffer.byteLength(appended, "utf8") };
  }

  async search(
    query: string,
    limit = 5,
  ): Promise<MemorySearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    await this.initialize();
    const documents = await this.collectDocuments();
    if (documents.length === 0) {
      return [];
    }

    const index = new MiniSearch<MemoryDocument>({
      fields: ["title", "content", "path"],
      storeFields: ["title", "path", "content"],
      idField: "id",
      searchOptions: {
        boost: { title: 2 },
        fuzzy: 0.2,
        prefix: true,
      },
    });
    index.addAll(documents);

    const byId = new Map(documents.map((document) => [document.id, document]));
    const results = index.search(trimmed, {
      boost: { title: 2 },
      fuzzy: 0.2,
      prefix: true,
    });

    return results.slice(0, Math.max(1, limit)).flatMap((result) => {
      const document = byId.get(String(result.id));
      if (!document) {
        return [];
      }
      return [
        {
          path: document.path,
          title: document.title,
          snippet: makeSnippet(document.content, trimmed),
          score: Math.round(result.score * 100) / 100,
        },
      ];
    });
  }

  async get(
    relativePath: string,
    startLine = 1,
    lineCount = 200,
  ): Promise<string> {
    await this.initialize();
    const file = await this.resolveMemoryPath(relativePath);
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new MemoryStoreError(`Memory file "${relativePath}" does not exist.`);
      }
      throw new MemoryStoreError(`Could not read memory file "${relativePath}".`, {
        cause: error,
      });
    }

    if (content.length === 0) {
      return `"${relativePath}" is empty.`;
    }

    const lines = content.split(/\r?\n/);
    if (lines.at(-1) === "") {
      lines.pop();
    }
    const startIndex = Math.max(0, startLine - 1);
    if (startIndex >= lines.length) {
      return `"${relativePath}" has ${lines.length} line(s); start_line ${startLine} is past the end.`;
    }

    const slice = lines.slice(startIndex, startIndex + Math.max(1, lineCount));
    return [
      `"${relativePath}" (lines ${startIndex + 1}-${startIndex + slice.length} of ${lines.length}):`,
      ...slice.map((line, index) => `${startIndex + index + 1} | ${line}`),
    ].join("\n");
  }

  private async doInitialize(): Promise<void> {
    await mkdir(path.join(this.root, "daily"), { recursive: true });
    this.realRoot = await realpath(this.root);
    const userFile = path.join(this.root, "USER.md");
    const memoryFile = path.join(this.root, "MEMORY.md");
    if ((await this.readOptional(userFile)) === undefined) {
      await writeFile(userFile, DEFAULT_USER, "utf8");
    }
    if ((await this.readOptional(memoryFile)) === undefined) {
      await writeFile(memoryFile, DEFAULT_MEMORY, "utf8");
    }
  }

  private async readOptional(file: string): Promise<string | undefined> {
    try {
      return await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw new MemoryStoreError(`Could not read "${file}".`, { cause: error });
    }
  }

  private async collectDocuments(): Promise<MemoryDocument[]> {
    const files = await this.walkMarkdown(this.root, 0);
    const documents: MemoryDocument[] = [];

    for (const file of files) {
      const relative = path.relative(this.root, file).split(path.sep).join("/");
      const content = await this.readOptional(file);
      if (content === undefined || content.trim().length === 0) {
        continue;
      }
      const title =
        content
          .split(/\r?\n/)
          .find((line) => line.startsWith("# "))
          ?.slice(2)
          .trim() ?? path.basename(file, ".md");
      documents.push({
        id: relative,
        title,
        content,
        path: relative,
      });
    }

    return documents;
  }

  private async walkMarkdown(directory: string, depth: number): Promise<string[]> {
    if (depth > 3) {
      return [];
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw new MemoryStoreError("Could not list memory files.", { cause: error });
    }

    const files: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.walkMarkdown(full, depth + 1)));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(full);
      }
    }
    return files;
  }

  private async resolveMemoryPath(relativePath: string): Promise<string> {
    const normalized = relativePath
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\//, "");
    if (!normalized || normalized.includes("\0")) {
      throw new MemoryStoreError("Invalid memory path.");
    }
    if (path.isAbsolute(normalized)) {
      throw new MemoryStoreError(
        "Memory paths must be relative to the memory directory.",
      );
    }
    if (normalized.split("/").includes("..")) {
      throw new MemoryStoreError("Memory path escapes the memory directory.");
    }

    const candidate = path.resolve(this.root, normalized);
    if (
      candidate !== this.root &&
      !candidate.startsWith(`${this.root}${path.sep}`)
    ) {
      throw new MemoryStoreError("Memory path escapes the memory directory.");
    }

    try {
      const real = await realpath(candidate);
      const rootReal = this.realRoot ?? (await realpath(this.root));
      if (real !== rootReal && !real.startsWith(`${rootReal}${path.sep}`)) {
        throw new MemoryStoreError(
          "Memory path escapes through a symbolic link.",
        );
      }
      const info = await stat(real);
      if (!info.isFile()) {
        throw new MemoryStoreError(`"${relativePath}" is not a file.`);
      }
      return real;
    } catch (error) {
      if (error instanceof MemoryStoreError) {
        throw error;
      }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new MemoryStoreError(`Memory file "${relativePath}" does not exist.`);
      }
      throw new MemoryStoreError(`Could not resolve "${relativePath}".`, {
        cause: error,
      });
    }
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function makeSnippet(content: string, query: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  const lower = compact.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 1);

  let index = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found !== -1 && (index === -1 || found < index)) {
      index = found;
    }
  }

  if (index === -1) {
    return compact.length > 280 ? `${compact.slice(0, 280)}…` : compact;
  }

  const start = Math.max(0, index - 100);
  const end = Math.min(compact.length, index + 180);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}
