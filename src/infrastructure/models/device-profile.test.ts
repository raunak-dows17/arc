import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectDeviceProfile,
  formatBytes,
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

  it("formats unknown and known byte values", () => {
    assert.equal(formatBytes(null), "unknown");
    assert.equal(formatBytes(16 * 1024 ** 3), "16.0 GB");
  });
});
