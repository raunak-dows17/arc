import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectDeviceProfile,
  formatBytes,
  parseLinuxMemAvailableBytes,
  parseVmStatAvailableBytes,
  type DeviceProfileOptions,
} from "./device-profile.js";

function options(overrides: DeviceProfileOptions): DeviceProfileOptions {
  return {
    platform: "linux",
    arch: "x64",
    cpus: [
      {
        model: "Test CPU",
        speed: 3000,
        times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
      },
    ],
    freeDiskBytes: 100 * 1024 ** 3,
    gpu: null,
    ...overrides,
  };
}

describe("device profile", () => {
  it("recommends cloud on a low-memory machine", async () => {
    const profile = await detectDeviceProfile(
      ".",
      options({ totalMemory: 8 * 1024 ** 3, freeMemory: 2 * 1024 ** 3 }),
    );
    assert.equal(profile.tier, "cloud-preferred");
    assert.match(profile.recommendation, /cloud/i);
  });

  it("treats a very small machine as cloud-only", async () => {
    const profile = await detectDeviceProfile(
      ".",
      options({ totalMemory: 4 * 1024 ** 3, freeMemory: 1 * 1024 ** 3 }),
    );
    assert.equal(profile.tier, "cloud-only");
  });

  it("marks a large GPU machine as local-capable", async () => {
    const profile = await detectDeviceProfile(
      ".",
      options({
        totalMemory: 32 * 1024 ** 3,
        freeMemory: 16 * 1024 ** 3,
        gpu: { name: "Test GPU", vramBytes: 12 * 1024 ** 3 },
      }),
    );
    assert.equal(profile.tier, "local-capable");
    assert.match(profile.recommendation, /optional/i);
  });

  it("detects Apple Silicon unified memory", async () => {
    const profile = await detectDeviceProfile(
      ".",
      options({
        platform: "darwin",
        arch: "arm64",
        totalMemory: 16 * 1024 ** 3,
        freeMemory: 10 * 1024 ** 3,
        gpu: undefined,
      }),
    );
    assert.equal(profile.gpu?.unifiedMemory, true);
    assert.equal(profile.gpu?.backend, "metal");
    assert.equal(profile.tier, "local-capable");
    assert.match(profile.reasons.join(" "), /unified memory/);
  });

  it("parses reclaimable macOS vm_stat pages", () => {
    const sample = [
      "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
      "Pages free:                                100.",
      "Pages inactive:                            200.",
      "Pages speculative:                          50.",
      "Pages purgeable:                            25.",
      "Pages wired down:                          999.",
      "Pages occupied by compressor:               999.",
    ].join("\n");
    assert.equal(parseVmStatAvailableBytes(sample), 375 * 16_384);
  });

  it("parses Linux MemAvailable", () => {
    const sample = [
      "MemTotal:       16384000 kB",
      "MemFree:         2048000 kB",
      "MemAvailable:    8192000 kB",
    ].join("\n");
    assert.equal(parseLinuxMemAvailableBytes(sample), 8_192_000 * 1_024);
    assert.equal(parseLinuxMemAvailableBytes("MemTotal: 1 kB"), null);
  });

  it("formats unknown and known byte values", () => {
    assert.equal(formatBytes(null), "unknown");
    assert.equal(formatBytes(16 * 1024 ** 3), "16.0 GB");
  });
});
