export type ToolSelection = "*" | readonly string[];
export type SkillSelection = "*" | readonly string[];

export interface AgentProfileProps {
  id: string;
  name: string;
  description: string;
  /** Profile-specific standing instructions. */
  systemPrompt: string;
  tools: ToolSelection;
  skills: SkillSelection;
  /** Per-turn tool-call budget. */
  maxSteps: number;
  /** Whether this profile may call run_agent. */
  canSpawn: boolean;
  /** Whether this profile may write long-term memory. */
  memoryWrite: boolean;
  /** The tool policy also omits write tools; this is a defence in depth. */
  readOnly: boolean;
  /** Built-in profiles can be overridden by AGENT_HOME/agents/<id>.md. */
  builtIn: boolean;
}

/**
 * A bounded role for the agent. Profiles provide context isolation and a
 * least-privilege tool set for sub-agents.
 */
export class AgentProfile {
  private constructor(private readonly props: AgentProfileProps) {}

  static create(props: AgentProfileProps): AgentProfile {
    return new AgentProfile({
      ...props,
      tools: props.tools === "*" ? "*" : [...props.tools],
      skills: props.skills === "*" ? "*" : [...props.skills],
    });
  }

  get id(): string {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
  }

  get description(): string {
    return this.props.description;
  }

  get systemPrompt(): string {
    return this.props.systemPrompt;
  }

  get tools(): ToolSelection {
    return this.props.tools;
  }

  get skills(): SkillSelection {
    return this.props.skills;
  }

  get maxSteps(): number {
    return this.props.maxSteps;
  }

  get canSpawn(): boolean {
    return this.props.canSpawn;
  }

  get memoryWrite(): boolean {
    return this.props.memoryWrite;
  }

  get readOnly(): boolean {
    return this.props.readOnly;
  }

  get builtIn(): boolean {
    return this.props.builtIn;
  }

  allowsTool(name: string): boolean {
    return this.props.tools === "*" || this.props.tools.includes(name);
  }

  allowsSkill(name: string): boolean {
    return this.props.skills === "*" || this.props.skills.includes(name);
  }

  toProps(): AgentProfileProps {
    return {
      ...this.props,
      tools: this.props.tools === "*" ? "*" : [...this.props.tools],
      skills: this.props.skills === "*" ? "*" : [...this.props.skills],
    };
  }
}
