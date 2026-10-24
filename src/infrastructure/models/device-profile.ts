import { execFile } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
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
    /** Apple Silicon and other integrated GPUs share the system memory pool. */
    unifiedMemory?: boolean;
    backend?: "metal" | "cuda" | "vulkan" | "cpu";
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
  const freeMemory =
    options.freeMemory !== undefined
      ? options.freeMemory
      : await availableMemoryBytes();
  const freeDiskBytes =
    options.freeDiskBytes !== undefined
      ? options.freeDiskBytes
      : await freeDisk(directory);
  const arch = options.arch ?? os.arch();
  const gpu =
    options.gpu !== undefined
      ? options.gpu
      : await detectGpu(platform, arch, totalMemory);
  const classification = classify(totalMemory, gpu);
  return {
    platform,
    arch,
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

/**
 * Returns reclaimable memory rather than strictly free pages. macOS uses
 * vm_stat (free + inactive + speculative + purgeable); Linux uses MemAvailable
 * from /proc/meminfo. Other platforms fall back to os.freemem().
 */
export async function availableMemoryBytes(): Promise<number> {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("vm_stat", [], {
        timeout: 1_500,
      });
      return parseVmStatAvailableBytes(stdout) ?? os.freemem();
    } catch {
      return os.freemem();
    }
  }
  if (process.platform === "linux") {
    try {
      const meminfo = await readFile("/proc/meminfo", "utf8");
      return parseLinuxMemAvailableBytes(meminfo) ?? os.freemem();
    } catch {
      return os.freemem();
    }
  }
  return os.freemem();
}

export function parseLinuxMemAvailableBytes(meminfo: string): number | null {
  const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/m);
  if (!match?.[1]) {
    return null;
  }
  const kilobytes = Number.parseInt(match[1], 10);
  return Number.isFinite(kilobytes) && kilobytes > 0
    ? kilobytes * 1_024
    : null;
}

export function parseVmStatAvailableBytes(stdout: string): number | null {
  const pageSizeMatch = stdout.match(/page size of (\d+) bytes/);
  const pageSize = pageSizeMatch?.[1]
    ? Number.parseInt(pageSizeMatch[1], 10)
    : 4_096;
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    return null;
  }
  const pages = [
    "Pages free",
    "Pages inactive",
    "Pages speculative",
    "Pages purgeable",
  ]
    .map((label) => {
      const match = stdout.match(
        new RegExp(`^${label}:\\s+(\\d+)\\.`, "m"),
      );
      return match?.[1] ? Number.parseInt(match[1], 10) : 0;
    })
    .reduce((sum, value) => sum + value, 0);
  return pages > 0 ? pages * pageSize : null;
}

function classify(
  totalMemory: number,
  gpu: DeviceProfile["gpu"],
): Pick<DeviceProfile, "tier" | "recommendation" | "reasons"> {
  const memoryGb = totalMemory / 1024 ** 3;
  const unified = gpu?.unifiedMemory === true;
  const vramGb = (gpu?.vramBytes ?? 0) / 1024 ** 3;
  const effectiveGpuGb = unified ? memoryGb : vramGb;
  const memoryLabel = unified
    ? `${memoryGb.toFixed(1)} GB unified memory`
    : `${memoryGb.toFixed(1)} GB RAM`;

  if (memoryGb < 8) {
    return {
      tier: "cloud-only",
      recommendation:
        "Use a cloud provider. Local generative models are likely to exhaust memory.",
      reasons: [`${memoryLabel} is below the 8 GB local-model floor.`],
    };
  }
  if (memoryGb < 16 || (!unified && effectiveGpuGb < 4)) {
    return {
      tier: "cloud-preferred",
      recommendation:
        "Use a cloud provider for chat and coding. Keep only a tiny local model for optional triage.",
      reasons: [
        `${memoryLabel} and ${effectiveGpuGb > 0 ? `${effectiveGpuGb.toFixed(1)} GB GPU memory` : "no detected GPU"} are a tight local-model budget.`,
      ],
    };
  }
  if (memoryGb < 32 && effectiveGpuGb < 8 && !unified) {
    return {
      tier: "balanced",
      recommendation:
        "Cloud is the default. A 3B–7B local model may work for lightweight tasks when the machine is idle.",
      reasons: [
        `${memoryLabel} can run a small model, but larger models may slow the system.`,
      ],
    };
  }
  return {
    tier: "local-capable",
    recommendation: unified
      ? "This machine can run a 7B–8B local model. Use local models for triage and short tasks; keep cloud for long agent loops."
      : "Cloud remains the default, but this machine can run a 7B–8B local model as an optional fallback.",
    reasons: [
      `${memoryLabel}${unified ? " is shared with the GPU" : effectiveGpuGb > 0 ? ` and ${effectiveGpuGb.toFixed(1)} GB GPU memory` : ""} meet the local 7B–8B guideline.`,
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

async function detectGpu(
  platform: NodeJS.Platform,
  arch: string,
  totalMemory: number,
): Promise<DeviceProfile["gpu"]> {
  if (platform === "darwin" && arch === "arm64") {
    return {
      name: "Apple Silicon GPU",
      vramBytes: totalMemory,
      unifiedMemory: true,
      backend: "metal",
    };
  }

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
      unifiedMemory: false,
      backend: "cuda",
    };
  } catch {
    return null;
  }
}
