import * as fs from "fs";
import * as path from "path";
import {
  TaskEntity,
  type TaskProperties,
  type TaskStatus,
} from "../../domain/entities/task.entities.js";
import type { UUID } from "../../shared/types/common.types.js";
import type { TaskRepositoryPort } from "../../domain/ports/task_repository.port.js";
import { agentLogger } from "../../shared/logger/pino.logger.js";

interface PersistedTaskRecord extends TaskProperties {
  agentId: UUID;
  updatedAt: string;
}

export class JsonTaskRepository implements TaskRepositoryPort {
  private readonly dbFilePath: string;

  constructor() {
    const storageDir = path.resolve(process.cwd(), "agent_sandbox");
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    this.dbFilePath = path.join(storageDir, "tasks_state.json");
    this.initializeStorage();
  }

  private initializeStorage(): void {
    if (!fs.existsSync(this.dbFilePath)) {
      fs.writeFileSync(this.dbFilePath, JSON.stringify([], null, 2), "utf-8");
    }
  }

  private async readAllRecords(): Promise<PersistedTaskRecord[]> {
    try {
      const rawData = await fs.promises.readFile(this.dbFilePath, "utf-8");
      return JSON.parse(rawData) as PersistedTaskRecord[];
    } catch (error: any) {
      agentLogger.error("Failed to read task persistence storage file", error);
      return [];
    }
  }

  private async writeAllRecords(records: PersistedTaskRecord[]): Promise<void> {
    try {
      await fs.promises.writeFile(
        this.dbFilePath,
        JSON.stringify(records, null, 2),
        "utf-8",
      );
    } catch (error: any) {
      agentLogger.error(
        "Failed to write records to task persistence storage file",
        error,
      );
    }
  }

  public async saveTask(agentId: UUID, task: TaskEntity): Promise<void> {
    const records = await this.readAllRecords();
    const existingIndex = records.findIndex((r) => r.id === task.id);

    const recordToSave: PersistedTaskRecord = {
      id: task.id,
      agentId,
      description: task.description,
      status: task.status,
      ...(task.result !== undefined ? { result: task.result } : {}),
      dependsOn: task.dependsOn,
      updatedAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      records[existingIndex] = recordToSave;
    } else {
      records.push(recordToSave);
    }

    await this.writeAllRecords(records);
    agentLogger.debug("Persisted task entity state to local storage", {
      taskId: task.id,
      status: task.status,
    });
  }

  public async getTasksByAgentId(agentId: UUID): Promise<TaskEntity[]> {
    const records = await this.readAllRecords();
    const agentTaskRecords = records.filter((r) => r.agentId === agentId);

    return agentTaskRecords.map(
      (record) =>
        new TaskEntity({
          id: record.id,
          description: record.description,
          status: record.status,
          ...(record.result !== undefined ? { result: record.result } : {}),
          ...(record.dependsOn !== undefined
            ? { dependsOn: record.dependsOn }
            : {}),
        }),
    );
  }

  public async updateTaskStatus(
    taskId: UUID,
    status: TaskStatus,
    result?: string,
  ): Promise<void> {
    const records = await this.readAllRecords();
    const targetRecord = records.find((r) => r.id === taskId);

    if (!targetRecord) {
      agentLogger.error(
        `Task persistence update failed: Task ID [${taskId}] not found`,
      );
      return;
    }

    targetRecord.status = status;
    if (result !== undefined) {
      targetRecord.result = result;
    }
    targetRecord.updatedAt = new Date().toISOString();

    await this.writeAllRecords(records);
    agentLogger.debug("Updated persisted task status", { taskId, status });
  }
}
