import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DecisionParseError } from "../../domain/errors/agent.errors.js";
import {
  buildDecisionFormat,
  extractJsonObject,
  parseDecision,
} from "./decision.schema.js";

describe("parseDecision", () => {
  it("parses a tool decision", () => {
    const decision = parseDecision(
      JSON.stringify({
        thought: "I should inspect the file.",
        tool: { name: "read_file", args: { path: "notes.md" } },
        final: null,
      }),
    );

    assert.equal(decision.thought, "I should inspect the file.");
    assert.equal(decision.toolCall?.name, "read_file");
    assert.deepEqual(decision.toolCall?.args, { path: "notes.md" });
    assert.equal(decision.finalAnswer, null);
  });

  it("parses a final decision and trims the answer", () => {
    const decision = parseDecision(
      JSON.stringify({ thought: "Done.", tool: null, final: "  answer  " }),
    );

    assert.equal(decision.finalAnswer, "answer");
    assert.equal(decision.toolCall, null);
  });

  it("tolerates code fences and surrounding prose", () => {
    const content = [
      "Here is my decision:",
      "```json",
      JSON.stringify({ thought: "", tool: null, final: "ok" }),
      "```",
    ].join("\n");

    assert.equal(parseDecision(content).finalAnswer, "ok");
  });

  it("rejects ambiguous decisions", () => {
    assert.throws(
      () =>
        parseDecision(
          JSON.stringify({
            thought: "",
            tool: { name: "read_file", args: {} },
            final: "also answer",
          }),
        ),
      DecisionParseError,
    );
  });

  it("rejects decisions with neither action", () => {
    assert.throws(
      () => parseDecision(JSON.stringify({ thought: "", tool: null, final: null })),
      DecisionParseError,
    );
  });

  it("rejects malformed JSON and unknown keys", () => {
    assert.throws(() => parseDecision("not json"), DecisionParseError);
    assert.throws(
      () =>
        parseDecision(
          JSON.stringify({
            thought: "",
            tool: null,
            final: "ok",
            extra: true,
          }),
        ),
      DecisionParseError,
    );
  });

  it("extracts the first JSON object from fenced content", () => {
    const extracted = extractJsonObject("```json\n{\"a\":1}\n```");
    assert.deepEqual(JSON.parse(extracted), { a: 1 });
  });

  it("repairs an unterminated string caused by an output limit", () => {
    const truncated =
      '{"thought":"Checking the file","tool":null,"final":"The answer is';
    assert.equal(parseDecision(truncated).finalAnswer, "The answer is");
  });
});

describe("buildDecisionFormat", () => {
  it("constrains the tool name to the registered tools", () => {
    const format = buildDecisionFormat(["read_file", "write_file"]);
    const serialized = JSON.stringify(format);

    assert.match(serialized, /"read_file"/);
    assert.match(serialized, /"write_file"/);
    assert.match(serialized, /"additionalProperties":false/);
  });

  it("returns a final-only grammar when no tools are available", () => {
    const format = buildDecisionFormat([]);
    const serialized = JSON.stringify(format);

    assert.match(serialized, /"tool":\{"type":"null"\}/);
    assert.match(serialized, /"required":\["thought","tool","final"\]/);
    assert.doesNotMatch(serialized, /"enum":\[\]/);
  });
});
