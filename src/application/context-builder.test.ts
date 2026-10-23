import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionMessage } from "../domain/entities/agent-session.js";
import { buildContextMessages } from "./services/context-builder.js";

const limits = {
  maxMessages: 10,
  maxContextChars: 10_000,
  maxObservationChars: 1_000,
};

function message(
  role: SessionMessage["role"],
  content: string,
  toolName?: string,
): SessionMessage {
  return {
    role,
    content,
    at: new Date().toISOString(),
    ...(toolName ? { toolName } : {}),
  };
}

describe("buildContextMessages", () => {
  it("maps tool observations to user messages with their source", () => {
    const context = buildContextMessages(
      [
        message("user", "read the file"),
        message("tool", "hello", "read_file"),
        message("assistant", "done"),
      ],
      limits,
    );

    assert.equal(context.length, 3);
    assert.equal(context[1]?.role, "user");
    assert.match(context[1]?.content ?? "", /read_file/);
    assert.match(context[1]?.content ?? "", /hello/);
  });

  it("keeps only the newest messages", () => {
    const context = buildContextMessages(
      [
        message("user", "old"),
        message("assistant", "old answer"),
        message("user", "new"),
      ],
      { ...limits, maxMessages: 2 },
    );

    assert.deepEqual(
      context.map((entry) => entry.content),
      ["old answer", "new"],
    );
  });

  it("truncates long tool observations", () => {
    const context = buildContextMessages(
      [message("user", "go"), message("tool", "x".repeat(500), "read_file")],
      { ...limits, maxObservationChars: 20 },
    );

    const observation = context.at(-1)?.content ?? "";
    assert.match(observation, /truncated/);
    assert.ok(observation.length < 200);
  });

  it("stops adding history once the character budget is reached", () => {
    const context = buildContextMessages(
      [
        message("user", "a".repeat(300)),
        message("assistant", "short"),
        message("user", "latest"),
      ],
      { ...limits, maxContextChars: 8 },
    );

    assert.equal(context.length, 1);
    assert.equal(context[0]?.content, "latest");
  });
});
