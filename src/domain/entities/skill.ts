export interface SkillProps {
  name: string;
  description: string;
  /** Short hint describing when the skill is useful. */
  whenToUse: string;
  /** Full Markdown instructions, loaded only on demand. */
  body: string;
  sourcePath: string;
  /** "*" or a list of profile ids that may use this skill. */
  agents: "*" | readonly string[];
  /** Tools the skill expects to be available. Informational. */
  tools: readonly string[];
}

/**
 * A lazily loaded instruction package. The index (name + description) is always
 * visible; the body enters context only when load_skill is called.
 */
export class Skill {
  private constructor(private readonly props: SkillProps) {}

  static create(props: SkillProps): Skill {
    return new Skill({
      ...props,
      agents: props.agents === "*" ? "*" : [...props.agents],
      tools: [...props.tools],
    });
  }

  get name(): string {
    return this.props.name;
  }

  get description(): string {
    return this.props.description;
  }

  get whenToUse(): string {
    return this.props.whenToUse;
  }

  get body(): string {
    return this.props.body;
  }

  get sourcePath(): string {
    return this.props.sourcePath;
  }

  get agents(): "*" | readonly string[] {
    return this.props.agents;
  }

  get tools(): readonly string[] {
    return this.props.tools;
  }

  matchesProfile(profileId: string): boolean {
    return this.props.agents === "*" || this.props.agents.includes(profileId);
  }
}
