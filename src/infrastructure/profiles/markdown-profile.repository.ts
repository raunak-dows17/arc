import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  AgentProfile,
  type AgentProfileProps,
} from "../../domain/entities/agent-profile.js";
import type { AgentProfileRepositoryPort } from "../../domain/ports/profile-repository.port.js";
import {
  booleanValue,
  listValue,
  numberValue,
  parseMarkdownDocument,
  stringValue,
} from "../markdown/frontmatter.js";

const SAFE_ID = /^[A-Za-z0-9._-]+$/;

const READ_ONLY_TOOLS = [
  "list_files",
  "read_file",
  "memory_search",
  "memory_get",
  "load_skill",
];

const BUILT_INS: AgentProfileProps[] = [
  {
    id: "assistant",
    name: "Assistant",
    description:
      "Default personal assistant: memory, notes, research, file work, and delegation.",
    systemPrompt: [
      "You are the user's local personal assistant. You help with thinking, writing, research, planning, and small coding or file tasks.",
      "Be proactive but careful: use memory_search before asking the user to repeat a preference, use load_skill when a listed skill matches the task, and delegate a clearly scoped research or review task to a sub-agent when that keeps your own context focused.",
      "Sub-agents run one at a time, cannot spawn more agents, and return a compact summary. Do not delegate work you can finish in one or two tool calls.",
      "Prefer durable Markdown notes and small files over long chat answers when the result should survive this conversation.",
    ].join("\n"),
    tools: "*",
    skills: "*",
    maxSteps: 12,
    canSpawn: true,
    memoryWrite: true,
    readOnly: false,
    builtIn: true,
  },
  {
    id: "researcher",
    name: "Researcher",
    description:
      "Read-only investigation and synthesis over the workspace and memory.",
    systemPrompt: [
      "You are a focused researcher. Investigate the task using only workspace reads, memory search, and skills.",
      "Do not modify files and do not ask to spawn other agents. Return a concise synthesis: findings, evidence (file paths or memory notes), uncertainties, and a recommended next step.",
    ].join("\n"),
    tools: READ_ONLY_TOOLS,
    skills: "*",
    maxSteps: 8,
    canSpawn: false,
    memoryWrite: false,
    readOnly: true,
    builtIn: true,
  },
  {
    id: "reviewer",
    name: "Reviewer",
    description:
      "Critical review of a plan, note, or code change without modifying it.",
    systemPrompt: [
      "You are a rigorous reviewer. Inspect the relevant files and memory, then report concrete problems and risks.",
      "Do not modify files. Prioritise correctness, safety, and maintainability. Return findings ordered by severity with file references, followed by a short verdict.",
    ].join("\n"),
    tools: READ_ONLY_TOOLS,
    skills: "*",
    maxSteps: 8,
    canSpawn: false,
    memoryWrite: false,
    readOnly: true,
    builtIn: true,
  },
  {
    id: "writer",
    name: "Writer",
    description: "Drafting and editing files in the workspace from a clear brief.",
    systemPrompt: [
      "You are a careful writer and editor working inside the workspace. Read existing source material before rewriting it.",
      "Write only the files needed for the brief. Preserve the user's voice, keep structure clear, and report exactly which files changed.",
      "Do not spawn agents. Do not write to sensitive paths.",
    ].join("\n"),
    tools: [...READ_ONLY_TOOLS, "write_file"],
    skills: "*",
    maxSteps: 8,
    canSpawn: false,
    memoryWrite: false,
    readOnly: false,
    builtIn: true,
  },
];

/**
 * Built-in profiles plus optional user overrides in AGENT_HOME/agents/*.md.
 * A user file with the same id replaces the built-in profile.
 */
export class MarkdownAgentProfileRepository
  implements AgentProfileRepositoryPort
{
  private profiles = new Map<string, AgentProfile>();
  private loaded = false;

  constructor(private readonly directory: string) {
    for (const profile of BUILT_INS) {
      this.profiles.set(profile.id, AgentProfile.create(profile));
    }
  }

  async get(id: string): Promise<AgentProfile | null> {
    await this.ensureLoaded();
    return this.profiles.get(id) ?? null;
  }

  async list(): Promise<AgentProfile[]> {
    await this.ensureLoaded();
    return [...this.profiles.values()].sort((left, right) => {
      if (left.builtIn !== right.builtIn) {
        return left.builtIn ? -1 : 1;
      }
      return left.id.localeCompare(right.id);
    });
  }

  async reload(): Promise<void> {
    const next = new Map<string, AgentProfile>();
    for (const profile of BUILT_INS) {
      next.set(profile.id, AgentProfile.create(profile));
    }

    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.profiles = next;
        this.loaded = true;
        return;
      }
      throw error;
    }

    for (const name of names.sort()) {
      if (!name.endsWith(".md")) {
        continue;
      }
      try {
        const file = path.join(this.directory, name);
        const profile = this.parseProfile(
          await readFile(file, "utf8"),
          name.slice(0, -3),
          file,
        );
        if (profile) {
          next.set(profile.id, profile);
        }
      } catch {
        // A malformed user profile must not prevent the CLI from starting.
      }
    }

    this.profiles = next;
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.reload();
    }
  }

  private parseProfile(
    text: string,
    filenameId: string,
    file: string,
  ): AgentProfile | null {
    const { data, body } = parseMarkdownDocument(text);
    const id =
      stringValue(data, ["id", "name"]) ?? filenameId.trim().toLowerCase();
    if (!SAFE_ID.test(id)) {
      return null;
    }

    const tools = listValue(data, ["tools"]);
    const skills = listValue(data, ["skills"]);
    const maxSteps = numberValue(data, ["maxSteps", "max_steps"]);

    return AgentProfile.create({
      id,
      name: stringValue(data, ["name"]) ?? id,
      description:
        stringValue(data, ["description"]) ?? `User profile from ${file}.`,
      systemPrompt: body,
      tools: tools ?? READ_ONLY_TOOLS,
      skills: skills ?? "*",
      maxSteps: Math.min(20, Math.max(1, Math.round(maxSteps ?? 8))),
      canSpawn: booleanValue(data, ["canSpawn", "can_spawn"]) ?? false,
      memoryWrite: booleanValue(data, ["memoryWrite", "memory_write"]) ?? false,
      readOnly: booleanValue(data, ["readOnly", "read_only"]) ?? true,
      builtIn: false,
    });
  }
}
