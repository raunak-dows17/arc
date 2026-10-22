import type { UUID } from "../../shared/types/common.types.js";
import type { TaskEntity } from "../entities/task.entities.js";

export interface TaskRepositoryPort {
  saveTask(agentId: UUID, task: TaskEntity): Promise<void>;
  getTasksByAgentId(agentId: UUID): Promise<TaskEntity[]>;
  updateTaskStatus(
    taskId: UUID,
    status: TaskEntity["status"],
    result?: string,
  ): Promise<void>;
}
