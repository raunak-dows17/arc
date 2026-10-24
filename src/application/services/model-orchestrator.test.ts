import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ModelRoleSettings,
  ModelSelection,
  ModelSettings,
} from "../../infrastructure/config/models.js";
import type { DeviceProfile } from "../../infrastructure/models/device-profile.js";
import { ProviderHealthRegistry } from "../../infrastructure/models/provider-health.js";
import {
  ModelOrchestrator,
  ModelRoutingError,
} from "./model-orchestrator.js";

const GIB = 1024 ** 3;

const cloudRoles: ModelRoleSettings = {
  main: { provider: "google", model: "gemini-3.6-flash" },
  research: { provider: "google", model: "gemini-3.6-flash" },
  coding: { provider: "google", model: "gemini-3.6-flash" },
  triage: { provider: "google", model: "gemini-3.5-flash-lite" },
  compaction: { provider: "google", model: "gemini-3.5-flash-lite" },
};

function settings(overrides: Partial<ModelSettings> = {}): ModelSettings {
  return {
    version: 1,
    mode: "hybrid",
    strategy: "balanced",
    privacy: { sensitiveData: "local" },
    providers: {
      ollama: {
        id: "ollama",
        kind: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        apiKeyAccount: "",
        jsonMode: true,
      },
      google: {
        id: "google",
        kind: "google",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        apiKeyAccount: "provider.google.api-key",
        jsonMode: true,
      },
    },
    roles: cloudRoles,
    pool: [
      { provider: "ollama", model: "qwen3:8b" },
      { provider: "ollama", model: "qwen2.5-coder:7b" },
      { provider: "ollama", model: "tev1:0.8b" },
      { provider: "ollama", model: "qwen3.6-35b-a3b" },
    ],
    fallback: [],
    ...overrides,
  };
}

function device(freeGb = 12, totalGb = 16): DeviceProfile {
  return {
    platform: "darwin",
    arch: "arm64",
    cpuModel: "Apple M4",
    cpuCores: 10,
    totalMemoryBytes: totalGb * GIB,
    freeMemoryBytes: freeGb * GIB,
    freeDiskBytes: 50 * GIB,
    gpu: {
      name: "Apple Silicon GPU",
      vramBytes: totalGb * GIB,
      unifiedMemory: true,
      backend: "metal",
    },
    tier: "local-capable",
    recommendation: "",
    reasons: [],
  };
}

function plan(
  modelSettings: ModelSettings,
  request: Parameters<ModelOrchestrator["plan"]>[0],
  options: { health?: ProviderHealthRegistry; device?: DeviceProfile } = {},
) {
  const orchestrator = new ModelOrchestrator({
    settings: modelSettings,
    health: options.health,
    device: options.device ?? device(),
  });
  return orchestrator.plan(request);
}

describe("ModelOrchestrator", () => {
  it("prefers a fitting local model for main work in hybrid mode", () => {
    const result = plan(settings(), { task: "main", requiresTools: true });
    assert.deepEqual(result.primary, { provider: "ollama", model: "qwen3:8b" });
    assert.equal(result.local, true);
    assert.match(result.reason, /Local ollama\/qwen3:8b/);
  });

  it("escalates research to cloud when local quality is materially lower", () => {
    const result = plan(settings(), { task: "research", requiresTools: true });
    assert.deepEqual(result.primary, {
      provider: "google",
      model: "gemini-3.6-flash",
    });
    assert.equal(result.local, false);
  });

  it("uses a coding-specialized local model for coding work", () => {
    const result = plan(settings(), { task: "coding", requiresTools: true });
    assert.deepEqual(result.primary, {
      provider: "ollama",
      model: "qwen2.5-coder:7b",
    });
  });

  it("keeps sensitive work local by default", () => {
    const result = plan(settings(), {
      task: "main",
      requiresTools: true,
      sensitive: true,
    });
    assert.deepEqual(result.primary, { provider: "ollama", model: "qwen3:8b" });
  });

  it("honours an explicit pin inside the selected boundary", () => {
    const explicit: ModelSelection = {
      provider: "google",
      model: "gemini-3.6-flash",
    };
    const result = plan(settings(), {
      task: "main",
      requiresTools: true,
      explicit,
    });
    assert.deepEqual(result.primary, explicit);
    assert.match(result.reason, /Explicit pin/);
  });

  it("ignores an explicit pin that crosses the cloud boundary", () => {
    const result = plan(settings({ mode: "cloud" }), {
      task: "main",
      requiresTools: true,
      explicit: { provider: "ollama", model: "qwen3:8b" },
    });
    assert.deepEqual(result.primary, {
      provider: "google",
      model: "gemini-3.6-flash",
    });
    assert.match(result.reason, /outside the cloud boundary/);
  });

  it("never selects cloud models in local mode", () => {
    assert.throws(
      () =>
        plan(settings({ mode: "local", pool: [] }), {
          task: "main",
          requiresTools: true,
        }),
      ModelRoutingError,
    );
  });

  it("skips a provider that is cooling down after a rate limit", () => {
    const health = new ProviderHealthRegistry();
    health.markUnavailable("ollama", "*", "HTTP 429: rate limited");
    const result = plan(
      settings(),
      { task: "main", requiresTools: true },
      { health },
    );
    assert.deepEqual(result.primary, {
      provider: "google",
      model: "gemini-3.6-flash",
    });
  });

  it("filters local models that do not fit the current memory budget", () => {
    const small = settings({
      pool: [{ provider: "ollama", model: "qwen3.6-35b-a3b" }],
    });
    const result = plan(
      small,
      { task: "research", requiresTools: true },
      { device: device(8, 16) },
    );
    assert.deepEqual(result.primary, {
      provider: "google",
      model: "gemini-3.6-flash",
    });
  });

  it("requires tool-capable models when the task needs tools", () => {
    const tiny = settings({
      mode: "local",
      pool: [{ provider: "ollama", model: "tev1:0.8b" }],
    });
    assert.throws(
      () => plan(tiny, { task: "main", requiresTools: true }),
      ModelRoutingError,
    );
  });

  it("relaxes the quality floor when local mode has no better option", () => {
    const tiny = settings({
      mode: "local",
      pool: [{ provider: "ollama", model: "qwen3:0.6b" }],
    });
    const result = plan(tiny, { task: "research", requiresTools: false });
    assert.deepEqual(result.primary, {
      provider: "ollama",
      model: "qwen3:0.6b",
    });
    assert.match(result.reason, /No model met/);
  });
});
