import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelSettings } from "../config/models.js";
import { ModelCatalog } from "./model-catalog.js";

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
    roles: {
      main: { provider: "google", model: "gemini-3.6-flash" },
      research: { provider: "google", model: "gemini-3.6-flash" },
      coding: { provider: "google", model: "gemini-3.6-flash" },
      triage: { provider: "google", model: "gemini-3.5-flash-lite" },
      compaction: { provider: "google", model: "gemini-3.5-flash-lite" },
    },
    pool: [],
    fallback: [],
    ...overrides,
  };
}

describe("ModelCatalog", () => {
  it("deduplicates roles, pool, and fallback entries", () => {
    const catalog = new ModelCatalog(
      settings({
        pool: [
          { provider: "ollama", model: "qwen3:8b" },
          { provider: "google", model: "gemini-3.6-flash" },
        ],
        fallback: [{ provider: "ollama", model: "qwen3:8b" }],
      }),
    );
    const entries = catalog.list();
    assert.equal(entries.length, 3);
    assert.equal(
      entries.filter((entry) => entry.model === "gemini-3.6-flash").length,
      1,
    );
  });

  it("marks Ollama models local and cloud models non-local", () => {
    const catalog = new ModelCatalog(
      settings({ pool: [{ provider: "ollama", model: "qwen3:8b" }] }),
    );
    const local = catalog.describe({ provider: "ollama", model: "qwen3:8b" });
    const cloud = catalog.describe({
      provider: "google",
      model: "gemini-3.6-flash",
    });
    assert.equal(local.local, true);
    assert.equal(local.sensitiveDataAllowed, true);
    assert.equal(local.costTier, 0);
    assert.equal(cloud.local, false);
    assert.equal(cloud.sensitiveDataAllowed, false);
    assert.equal(cloud.costTier, 1);
  });

  it("recognizes coding-specialized and tool-capable models", () => {
    const catalog = new ModelCatalog(settings());
    const coder = catalog.describe({
      provider: "ollama",
      model: "qwen2.5-coder:7b",
    });
    const tiny = catalog.describe({ provider: "ollama", model: "tev1:0.8b" });
    assert.ok(coder.coding > 0.8);
    assert.equal(coder.toolCalling, true);
    assert.equal(tiny.toolCalling, false);
    assert.ok(tiny.triage > 0.9);
  });

  it("skips selections from providers that are not configured", () => {
    const catalog = new ModelCatalog(
      settings({
        pool: [{ provider: "missing", model: "ghost-model" }],
      }),
    );
    assert.equal(
      catalog.list().some((entry) => entry.provider === "missing"),
      false,
    );
  });
});
