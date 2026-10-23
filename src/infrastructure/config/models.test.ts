import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  formatModelRef,
  legacyModelSettings,
  loadModelSettings,
  parseModelRef,
  presetProvider,
} from "./models.js";
import { saveModelSettings, setRole } from "../models/model-config.store.js";

describe("model settings", () => {
  let directory: string;

  before(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "arc-models-"));
  });

  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("uses legacy Ollama routing when models.json is absent", () => {
    const settings = loadModelSettings({
      arcHome: path.join(directory, "legacy"),
      env: {},
      legacy: {
        ollamaBaseUrl: "http://127.0.0.1:11434",
        main: "qwen3:8b",
        research: "qwen3:8b",
        coding: "qwen2.5-coder:7b",
        decision: "tev1:0.8b",
      },
    });

    assert.deepEqual(settings.roles.main, {
      provider: "ollama",
      model: "qwen3:8b",
    });
    assert.deepEqual(settings.roles.triage, {
      provider: "ollama",
      model: "tev1:0.8b",
    });
  });

  it("round-trips models.json and ignores legacy model env when the file exists", async () => {
    const home = path.join(directory, "configured");
    const google = presetProvider("google");
    assert.ok(google);
    let settings = legacyModelSettings({
      ollamaBaseUrl: "http://127.0.0.1:11434",
      main: "qwen3:8b",
      research: "qwen3:8b",
      coding: "qwen2.5-coder:7b",
      decision: "tev1:0.8b",
    });
    settings = {
      ...settings,
      providers: { google },
      roles: {
        main: { provider: "google", model: "gemini-3.6-flash" },
        research: { provider: "google", model: "gemini-3.6-flash" },
        coding: { provider: "google", model: "gemini-3.6-flash" },
        triage: { provider: "google", model: "gemini-3.5-flash-lite" },
        compaction: { provider: "google", model: "gemini-3.5-flash-lite" },
      },
    };
    await saveModelSettings(home, settings);

    const loaded = loadModelSettings({
      arcHome: home,
      env: { ARC_MODEL: "qwen3:8b" },
      legacy: {
        ollamaBaseUrl: "http://127.0.0.1:11434",
        main: "qwen3:8b",
        research: "qwen3:8b",
        coding: "qwen2.5-coder:7b",
        decision: "tev1:0.8b",
      },
    });
    assert.deepEqual(loaded.roles.main, {
      provider: "google",
      model: "gemini-3.6-flash",
    });

    const sameProvider = loadModelSettings({
      arcHome: home,
      env: {
        ARC_MODEL_PROVIDER: "google",
        // Stale legacy values from an existing .env must not replace the
        // provider routing already stored in models.json.
        ARC_MODEL: "qwen3:8b",
        ARC_CODING_MODEL: "qwen2.5-coder:7b",
        ARC_DECISION_MODEL: "tev1:0.8b",
      },
      legacy: {
        ollamaBaseUrl: "http://127.0.0.1:11434",
        main: "qwen3:8b",
        research: "qwen3:8b",
        coding: "qwen2.5-coder:7b",
        decision: "tev1:0.8b",
      },
    });
    assert.deepEqual(sameProvider.roles.main, {
      provider: "google",
      model: "gemini-3.6-flash",
    });
    assert.deepEqual(sameProvider.roles.triage, {
      provider: "google",
      model: "gemini-3.5-flash-lite",
    });

    const overridden = loadModelSettings({
      arcHome: home,
      env: {
        ARC_MODEL_PROVIDER: "groq",
        ARC_MODEL: "llama-3.3-70b-versatile",
      },
      legacy: {
        ollamaBaseUrl: "http://127.0.0.1:11434",
        main: "qwen3:8b",
        research: "qwen3:8b",
        coding: "qwen2.5-coder:7b",
        decision: "tev1:0.8b",
      },
    });
    assert.deepEqual(overridden.roles.main, {
      provider: "groq",
      model: "llama-3.3-70b-versatile",
    });
  });

  it("parses and formats provider/model references", () => {
    assert.deepEqual(parseModelRef("openrouter/meta-llama/model:free"), {
      provider: "openrouter",
      model: "meta-llama/model:free",
    });
    assert.equal(
      formatModelRef({ provider: "google", model: "gemini-3.6-flash" }),
      "google/gemini-3.6-flash",
    );
    assert.throws(() => parseModelRef("no-provider"));
  });

  it("updates one role without mutating the original", () => {
    const settings = legacyModelSettings({
      ollamaBaseUrl: "http://127.0.0.1:11434",
      main: "qwen3:8b",
      research: "qwen3:8b",
      coding: "qwen2.5-coder:7b",
      decision: "tev1:0.8b",
    });
    const updated = setRole(settings, "coding", {
      provider: "groq",
      model: "qwen/qwen3-32b",
    });
    assert.deepEqual(updated.roles.coding, {
      provider: "groq",
      model: "qwen/qwen3-32b",
    });
    assert.equal(settings.roles.coding.model, "qwen2.5-coder:7b");
  });
});
