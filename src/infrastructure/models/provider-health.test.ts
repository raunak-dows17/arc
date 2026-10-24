import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DecisionParseError } from "../../domain/errors/agent.errors.js";
import {
  ProviderHealthRegistry,
  classifyFailure,
} from "./provider-health.js";

describe("ProviderHealthRegistry", () => {
  it("starts available and records a successful call", () => {
    const health = new ProviderHealthRegistry();
    assert.equal(health.isAvailable("google", "gemini-3.6-flash"), true);
    health.recordSuccess("google", "gemini-3.6-flash", 120);
    const snapshot = health.snapshot("google", "gemini-3.6-flash");
    assert.equal(snapshot.available, true);
    assert.equal(snapshot.failures, 0);
    assert.equal(snapshot.latencyMs, 120);
  });

  it("cools down a rate-limited model and recovers after the window", () => {
    const health = new ProviderHealthRegistry();
    const now = 1_000_000;
    assert.equal(
      health.recordFailure("google", "gemini-3.6-flash", new Error("HTTP 429"), now),
      "rate-limit",
    );
    assert.equal(health.isAvailable("google", "gemini-3.6-flash", now), false);
    assert.equal(
      health.isAvailable("google", "gemini-3.6-flash", now + 60_001),
      true,
    );
  });

  it("resets a cooldown after a later success", () => {
    const health = new ProviderHealthRegistry();
    health.recordFailure("ollama", "qwen3:8b", new Error("connection refused"));
    assert.equal(health.isAvailable("ollama", "qwen3:8b"), false);
    health.recordSuccess("ollama", "qwen3:8b", 25);
    assert.equal(health.isAvailable("ollama", "qwen3:8b"), true);
  });

  it("does not penalize a provider for an invalid model decision", () => {
    const health = new ProviderHealthRegistry();
    health.recordFailure(
      "google",
      "gemini-3.6-flash",
      new DecisionParseError("invalid JSON"),
    );
    assert.equal(health.isAvailable("google", "gemini-3.6-flash"), true);
  });

  it("can mark an entire provider unavailable until restart", () => {
    const health = new ProviderHealthRegistry();
    health.markUnavailable("colibri", "*", "missing API key");
    assert.equal(health.isAvailable("colibri", "laya"), false);
    assert.equal(health.snapshot("colibri", "*").lastError, "missing API key");
  });

  it("classifies common provider failures", () => {
    assert.equal(classifyFailure(new Error("HTTP 429: too many requests")), "rate-limit");
    assert.equal(classifyFailure(new Error("401 unauthorized")), "auth");
    assert.equal(classifyFailure(new Error("request timed out")), "timeout");
    assert.equal(classifyFailure(new Error("maximum context length")), "context");
    assert.equal(classifyFailure(new Error("503 unavailable")), "server");
    assert.equal(classifyFailure(new Error("something else")), "unknown");
  });
});
