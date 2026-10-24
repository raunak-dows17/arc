import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ModelOrchestrator,
  ModelRoutingRequest,
} from "./services/model-orchestrator.js";
import { ModelRouter } from "./services/model-router.js";

const routerCatalog = {
  main: { provider: "google", model: "gemini-2.5-flash" },
  research: { provider: "google", model: "gemini-2.5-flash" },
  coding: { provider: "groq", model: "qwen/qwen3-32b" },
  triage: { provider: "google", model: "gemini-2.5-flash-lite" },
  compaction: { provider: "google", model: "gemini-2.5-flash-lite" },
};

const router = new ModelRouter(routerCatalog);

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

  it("adds task defaults before calling the orchestrator", () => {
    const requests: ModelRoutingRequest[] = [];
    const orchestrator = {
      plan: (request: ModelRoutingRequest) => {
        requests.push(request);
        return {
          primary: { provider: "google", model: "gemini-2.5-flash" },
          fallbacks: [],
          reason: "test",
          local: false,
        };
      },
    } as unknown as ModelOrchestrator;
    const routed = new ModelRouter(routerCatalog, orchestrator);

    routed.planForProfile("coder", { contextChars: 4_000 });

    assert.equal(requests[0]?.task, "coding");
    assert.equal(requests[0]?.requiresTools, true);
    assert.equal(requests[0]?.contextChars, 4_000);

    routed.setPin({ provider: "google", model: "pinned-model" });
    routed.planForProfile("arc");
    assert.deepEqual(requests[1]?.explicit, {
      provider: "google",
      model: "pinned-model",
    });
  });

  it("uses a session pin when no orchestrator is configured", () => {
    const pinned = new ModelRouter(routerCatalog);
    pinned.setPin({ provider: "google", model: "pinned-model" });
    assert.deepEqual(pinned.resolve("main"), {
      provider: "google",
      model: "pinned-model",
    });
  });

  it("exposes the decision model separately", () => {
    assert.deepEqual(router.decisionModel, {
      provider: "google",
      model: "gemini-2.5-flash-lite",
    });
  });
});
