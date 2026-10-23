import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type DeviceTier =
  | "cloud-only"
  | "cloud-preferred"
  | "balanced"
  | "local-capable";

export interface DeviceProfile {
  platform: NodeJS.Platform;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  freeDiskBytes: number | null;
  gpu: {
    name: string;
    vramBytes?: number;
  } | null;
  tier: DeviceTier;
  recommendation: string;
  reasons: string[];
}

export interface DeviceProfileOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  cpus?: os.CpuInfo[];
  totalMemory?: number;
  freeMemory?: number;
  freeDiskBytes?: number | null;
  gpu?: DeviceProfile["gpu"];
}

export async function detectDeviceProfile(
  directory: string,
  options: DeviceProfileOptions = {},
): Promise<DeviceProfile> {
  const platform = options.platform ?? process.platform;
  const cpus = options.cpus ?? os.cpus();
  const totalMemory = options.totalMemory ?? os.totalmem();
  const freeMemory = options.freeMemory ?? os.freemem();
  const freeDiskBytes =
    options.freeDiskBytes !== undefined
      ? options.freeDiskBytes
      : await freeDisk(directory);
  const gpu = options.gpu !== undefined ? options.gpu : await detectGpu();
  const classification = classify(totalMemory, gpu);
  return {
    platform,
    arch: options.arch ?? os.arch(),
    cpuModel: cpus[0]?.model.trim() || "unknown CPU",
    cpuCores: cpus.length,
    totalMemoryBytes: totalMemory,
    freeMemoryBytes: freeMemory,
    freeDiskBytes,
    gpu,
    ...classification,
  };
}

export function formatBytes(value: number | null): string {
  if (value === null) {
    return "unknown";
  }
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function classify(
  totalMemory: number,
  gpu: DeviceProfile["gpu"],
): Pick<DeviceProfile, "tier" | "recommendation" | "reasons"> {
  const memoryGb = totalMemory / 1024 ** 3;
  const vramGb = (gpu?.vramBytes ?? 0) / 1024 ** 3;
  if (memoryGb < 8) {
    return {
      tier: "cloud-only",
      recommendation:
        "Use a cloud provider. Local generative models are likely to exhaust memory.",
      reasons: [`${memoryGb.toFixed(1)} GB RAM is below the 8 GB local-model floor.`],
    };
  }
  if (memoryGb < 16 || vramGb < 4) {
    return {
      tier: "cloud-preferred",
      recommendation:
        "Use a cloud provider for chat and coding. Keep only a tiny local model for optional triage.",
      reasons: [
        `${memoryGb.toFixed(1)} GB RAM and ${vramGb > 0 ? `${vramGb.toFixed(1)} GB VRAM` : "no detected discrete GPU"} are a tight local-model budget.`,
      ],
    };
  }
  if (memoryGb < 32 && vramGb < 8) {
    return {
      tier: "balanced",
      recommendation:
        "Cloud is the default. A 3B–7B local model may work for lightweight tasks when the machine is idle.",
      reasons: [
        `${memoryGb.toFixed(1)} GB RAM can run a small model, but larger models may slow the system.`,
      ],
    };
  }
  return {
    tier: "local-capable",
    recommendation:
      "Cloud remains the default, but this machine can run a 7B–8B local model as an optional fallback.",
    reasons: [
      `${memoryGb.toFixed(1)} GB RAM${vramGb > 0 ? ` and ${vramGb.toFixed(1)} GB VRAM` : ""} meet the local 7B–8B guideline.`,
    ],
  };
}

async function freeDisk(directory: string): Promise<number | null> {
  try {
    const stats = await statfs(directory);
    return Number(stats.bsize) * Number(stats.bavail);
  } catch {
    return null;
  }
}

async function detectGpu(): Promise<DeviceProfile["gpu"]> {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      [
        "--query-gpu=name,memory.total",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 1_500, windowsHide: true },
    );
    const first = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!first) {
      return null;
    }
    const [name, memory] = first.split(",").map((part) => part.trim());
    if (!name) {
      return null;
    }
    const megabytes = Number(memory);
    return {
      name,
      ...(Number.isFinite(megabytes) && megabytes > 0
        ? { vramBytes: megabytes * 1024 ** 2 }
        : {}),
    };
  } catch {
    return null;
  }
}
