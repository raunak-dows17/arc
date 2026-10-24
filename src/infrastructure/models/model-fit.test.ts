import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DeviceProfile } from "./device-profile.js";
import {
  contextTokensFromChars,
  estimateLocalModelFit,
} from "./model-fit.js";

const GIB = 1024 ** 3;

function device(freeGb: number, totalGb = 16): DeviceProfile {
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

describe("local model fit", () => {
  it("fits an 8B model when enough memory is free", () => {
    const fit = estimateLocalModelFit(device(12), "qwen3:8b");
    assert.equal(fit.fits, true);
    assert.ok(fit.requirements.totalBytes < fit.availableBytes);
    assert.ok(fit.estimatedDecodeTokensPerSecond > 0);
  });

  it("rejects an 8B model when the free-memory budget is tight", () => {
    const fit = estimateLocalModelFit(device(6), "qwen3:8b");
    assert.equal(fit.fits, false);
    assert.match(fit.reasons.join(" "), /does not fit/);
  });

  it("rejects a 35B model on a 16 GB machine", () => {
    const fit = estimateLocalModelFit(device(12), "qwen3.6-35b-a3b");
    assert.equal(fit.fits, false);
    assert.ok(fit.requirements.totalBytes > 20 * GIB);
  });

  it("grows the KV cache estimate with context length", () => {
    const short = estimateLocalModelFit(device(12), "qwen3:8b", 2_048);
    const long = estimateLocalModelFit(device(12), "qwen3:8b", 16_384);
    assert.ok(long.requirements.kvCacheBytes > short.requirements.kvCacheBytes);
    assert.ok(long.estimatedPrefillMs > short.estimatedPrefillMs);
  });

  it("uses a conservative context estimate with a floor", () => {
    assert.equal(contextTokensFromChars(0), 1_024);
    assert.equal(contextTokensFromChars(40_000), 10_000);
  });
});
