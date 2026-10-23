import type {
  AgentEvent,
  AgentEventListener,
  AgentEventType,
  EventBusPort,
} from "../../domain/events/agent-event.js";

/**
 * Synchronous in-process event bus. Listeners are isolated: one failing
 * listener never interrupts the agent loop or another listener.
 */
export class InMemoryEventBus implements EventBusPort {
  private readonly listeners = new Map<AgentEventType | "*", Set<AgentEventListener>>();

  emit(
    type: AgentEventType,
    input: {
      sessionId: string;
      agentId: string;
      data?: Record<string, unknown>;
    },
  ): void {
    const event: AgentEvent = {
      type,
      at: new Date().toISOString(),
      sessionId: input.sessionId,
      agentId: input.agentId,
      data: input.data ?? {},
    };

    const targets = [
      ...(this.listeners.get(type) ?? []),
      ...(this.listeners.get("*") ?? []),
    ];
    for (const listener of targets) {
      try {
        listener(event);
      } catch {
        // Telemetry must never break a turn.
      }
    }
  }

  on(type: AgentEventType | "*", listener: AgentEventListener): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }
}
