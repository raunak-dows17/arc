import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ModelRouter } from "./services/model-router.js";

const router = new ModelRouter({
  main: { provider: "google", model: "gemini-2.5-flash" },
  research: { provider: "google", model: "gemini-2.5-flash" },
  coding: { provider: "groq", model: "qwen/qwen3-32b" },
  triage: { provider: "google", model: "gemini-2.5-flash-lite" },
  compaction: { provider: "google", model: "gemini-2.5-flash-lite" },
});

describe("ModelRouter", () => {
  it("routes explicit tasks", () => {
    assert.deepEqual(router.resolve("main"), {
      provider: "google",
      model: "gemini-2.5-flash",
    });
    assert.deepEqual(router.resolve("coding"), {
      provider: "groq",
      model: "qwen/qwen3-32b",
    });
    assert.deepEqual(router.resolve("triage"), {
      provider: "google",
      model: "gemini-2.5-flash-lite",
    });
  });

  it("routes known profiles", () => {
    assert.deepEqual(router.resolveForProfile("arc"), {
      provider: "google",
      model: "gemini-2.5-flash",
    });
    assert.deepEqual(router.resolveForProfile("coder"), {
      provider: "groq",
      model: "qwen/qwen3-32b",
    });
    assert.deepEqual(router.resolveForProfile("researcher"), {
      provider: "google",
      model: "gemini-2.5-flash",
    });
  });

  it("exposes the decision model separately", () => {
    assert.deepEqual(router.decisionModel, {
      provider: "google",
      model: "gemini-2.5-flash-lite",
    });
  });
});
