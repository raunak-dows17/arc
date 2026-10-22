import type { UUID } from "../../shared/types/common.types.js";
import type { DomainMessage } from "../ports/llm.port.js";

export interface MemoryProperties {
  id: UUID;
  agentId: UUID;
  conversationHistory: DomainMessage[];
  summary?: string;
}

export class MemoryEntity {
  private props: MemoryProperties;

  constructor(props: MemoryProperties) {
    this.props = { ...props };
  }

  public get id(): UUID {
    return this.props.id;
  }
  public get agentId(): UUID {
    return this.props.agentId;
  }
  public get conversationHistory(): DomainMessage[] {
    return this.props.conversationHistory;
  }
  public get summary(): string | undefined {
    return this.props.summary;
  }

  // To add new message in short term memory...
  public addMessage(message: DomainMessage): void {
    this.props.conversationHistory.push(message);
  }

  // To upadte the summary to save the token
  public updateSummary(newSummary: string): void {
    this.props.summary = newSummary;
  }

  // To Clear the old messages (when summarized)
  public truncateHistory(keepLastN: number): void {
    if (this.props.conversationHistory.length > keepLastN) {
      this.props.conversationHistory =
        this.props.conversationHistory.slice(-keepLastN);
    }
  }
}
