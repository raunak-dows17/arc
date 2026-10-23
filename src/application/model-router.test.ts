import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ModelRouter } from "./services/model-router.js";

const router = new ModelRouter({
  main: "qwen3:8b",
  research: "qwen3:8b",
  coding: "qwen2.5-coder:7b",
  decision: "tev1:0.8b",
});

describe("ModelRouter", () => {
  it("routes explicit tasks", () => {
    assert.equal(router.resolve("main"), "qwen3:8b");
    assert.equal(router.resolve("research"), "qwen3:8b");
    assert.equal(router.resolve("coding"), "qwen2.5-coder:7b");
    assert.equal(router.resolve("compaction"), "qwen3:8b");
  });

  it("routes known profiles", () => {
    assert.equal(router.resolveForProfile("arc"), "qwen3:8b");
    assert.equal(router.resolveForProfile("coder"), "qwen2.5-coder:7b");
    assert.equal(router.resolveForProfile("researcher"), "qwen3:8b");
    assert.equal(router.resolveForProfile("reviewer"), "qwen3:8b");
  });

  it("exposes the decision model separately", () => {
    assert.equal(router.decisionModel, "tev1:0.8b");
    assert.deepEqual(router.snapshot(), {
      main: "qwen3:8b",
      research: "qwen3:8b",
      coding: "qwen2.5-coder:7b",
      decision: "tev1:0.8b",
    });
  });
});
