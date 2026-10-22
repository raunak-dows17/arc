export type UUID = string;

export interface BaseMetadata {
  createdAt: Date;
  updatedAt: Date;
  [kay: string]: any;
}

export interface Result<T, E = Error> {
  success: boolean;
  value?: T;
  error?: E;
}

export interface AgentTraceStep {
  id: UUID;
  iteration: number;
  type: "thought" | "action" | "observation" | "system_error";
  payload: string;
  timestamp: string;
}
