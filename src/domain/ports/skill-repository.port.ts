import type { Skill } from "../entities/skill.js";

export interface SkillRepositoryPort {
  get(name: string): Promise<Skill | null>;
  list(): Promise<Skill[]>;
  /** Re-scan skill directories. */
  reload(): Promise<void>;
}
