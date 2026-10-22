import type { UUID } from "../../shared/types/common.types.js";

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface TaskProperties {
  id: UUID;
  description: string;
  status: TaskStatus;
  result?: string;
  dependsOn?: UUID[];
}

export class TaskEntity {
  private props: TaskProperties;

  constructor(props: TaskProperties) {
    this.props = { ...props };
  }

  public get id(): UUID {
    return this.props.id;
  }
  public get description(): string {
    return this.props.description;
  }
  public get status(): TaskStatus {
    return this.props.status;
  }
  public get result(): string | undefined {
    return this.props.result;
  }
  public get dependsOn(): UUID[] {
    return this.props.dependsOn || [];
  }

  public start(): void {
    if (this.props.status !== "pending") {
      throw new Error(
        `Cannot start a task that is currently ${this.props.status}`,
      );
    }
    this.props.status = "running";
  }

  public complete(result: string): void {
    if (this.props.status !== "running") {
      throw new Error("Can only complete tasks that are in a running state");
    }
    this.props.status = "completed";
    this.props.result = result;
  }

  public fail(reason: string): void {
    this.props.status = "failed";
    this.props.result = reason;
  }
}
