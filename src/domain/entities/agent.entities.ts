import type { UUID } from "../../shared/types/common.types.js";
import type { TaskEntity } from "./task.entities.js";

export interface AgentProperties {
  id: UUID;
  goal: string;
  maxIterations: number;
  currentIteration: number;
  tasks: TaskEntity[];
}

export class AgentEntity {
  private props: AgentProperties;

  constructor(props: AgentProperties) {
    this.props = { ...props };
  }

  public get id(): UUID {
    return this.props.id;
  }
  public get goal(): string {
    return this.props.goal;
  }
  public get currentIteration(): number {
    return this.props.currentIteration;
  }
  public get tasks(): TaskEntity[] {
    return this.props.tasks;
  }

  public incrementIteration(): void {
    if (this.props.currentIteration >= this.props.maxIterations) {
      throw new Error(
        `Agent execution safety halt: Max iterations (${this.props.maxIterations}) exceeded.`,
      );
    }
    this.props.currentIteration += 1;
  }

  public isGoalAchieved(): boolean {
    if (this.props.tasks.length === 0) return false;
    return this.props.tasks.every((task) => task.status === "completed");
  }

  public addTask(task: TaskEntity): void {
    this.props.tasks.push(task);
  }
}
