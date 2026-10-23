import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Skill } from "../../domain/entities/skill.js";
import type { SkillRepositoryPort } from "../../domain/ports/skill-repository.port.js";
import {
  listValue,
  parseMarkdownDocument,
  stringValue,
} from "../markdown/frontmatter.js";

/**
 * Scans SKILL.md files from lowest to highest precedence:
 *   <repo>/skills → ARC_HOME/skills → WORKSPACE/.skills
 * A later skill with the same name replaces an earlier one.
 */
export class MarkdownSkillRepository implements SkillRepositoryPort {
  private skills = new Map<string, Skill>();
  private loaded = false;

  constructor(private readonly directories: readonly string[]) {}

  async get(name: string): Promise<Skill | null> {
    await this.ensureLoaded();
    return this.skills.get(name) ?? null;
  }

  async list(): Promise<Skill[]> {
    await this.ensureLoaded();
    return [...this.skills.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  async reload(): Promise<void> {
    const next = new Map<string, Skill>();

    for (const directory of this.directories) {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw error;
      }

      for (const entry of entries.sort((left, right) =>
        left.name.localeCompare(right.name),
      )) {
        if (!entry.isDirectory()) {
          continue;
        }
        const file = path.join(directory, entry.name, "SKILL.md");
        try {
          const skill = this.parseSkill(await readFile(file, "utf8"), file, entry.name);
          if (skill) {
            next.set(skill.name, skill);
          }
        } catch {
          // Ignore a malformed skill; the rest of the catalogue still loads.
        }
      }
    }

    this.skills = next;
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.reload();
    }
  }

  private parseSkill(
    text: string,
    file: string,
    directoryName: string,
  ): Skill | null {
    const { data, body } = parseMarkdownDocument(text);
    const name = stringValue(data, ["name"]) ?? directoryName;
    if (!name.trim()) {
      return null;
    }

    const tools = listValue(data, ["tools"]);
    return Skill.create({
      name: name.trim(),
      description:
        stringValue(data, ["description"]) ?? "No description provided.",
      whenToUse:
        stringValue(data, ["whenToUse", "when_to_use", "when"]) ?? "",
      body,
      sourcePath: file,
      agents: listValue(data, ["agents"]) ?? "*",
      tools: tools === undefined || tools === "*" ? [] : tools,
    });
  }
}
