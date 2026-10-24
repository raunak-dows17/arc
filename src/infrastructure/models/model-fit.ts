import type { DeviceProfile } from "./device-profile.js";

const GIB = 1024 ** 3;
const SYSTEM_RESERVE_BYTES = 2 * GIB;

/** Known installed/container sizes are more reliable than parameter guesses. */
const KNOWN_MODEL_BYTES: Record<string, number> = {
  "qwen3:0.6b": 0.52 * GIB,
  "qwen3:8b": 5.2 * GIB,
  "qwen2.5-coder:7b": 4.7 * GIB,
  "tev1:0.8b": 1.5 * GIB,
  "qwen3-coder-30b-a3b": 19 * GIB,
  "qwen3.6-35b-a3b": 23 * GIB,
  olmoe: 7 * GIB,
  laya: 1.7 * GIB,
};

export interface LocalModelRequirements {
  weightsBytes: number;
  kvCacheBytes: number;
  overheadBytes: number;
  totalBytes: number;
}

export interface LocalModelFit {
  fits: boolean;
  availableBytes: number;
  requirements: LocalModelRequirements;
  estimatedPrefillMs: number;
  estimatedDecodeTokensPerSecond: number;
  reasons: string[];
}

/**
 * Estimates whether a local model is usable for ARC's actual context. The
 * estimate is intentionally conservative: a model that barely fits can still
 * be unusable for an interactive agent because of prefill latency.
 */
export function estimateLocalModelFit(
  profile: DeviceProfile,
  model: string,
  contextTokens = 8_192,
): LocalModelFit {
  const weightsBytes = estimateWeightsBytes(model);
  const kvCacheBytes = estimateKvCacheBytes(model, contextTokens);
  const overheadBytes = 1.5 * GIB;
  const totalBytes = weightsBytes + kvCacheBytes + overheadBytes;
  const availableBytes = Math.max(
    0,
    profile.freeMemoryBytes - SYSTEM_RESERVE_BYTES,
  );
  const large = estimateParameterBillions(model) >= 14;
  const cpuOnly =
    profile.gpu === null || profile.gpu.backend === "cpu" || large;
  const prefillMsPerToken = cpuOnly ? (large ? 30 : 8) : 3;
  const estimatedPrefillMs = Math.round(contextTokens * prefillMsPerToken);
  const estimatedDecodeTokensPerSecond = cpuOnly
    ? large
      ? 5
      : 14
    : 25;

  const reasons = [
    `Estimated need ${formatGib(totalBytes)} (${formatGib(weightsBytes)} weights, ${formatGib(kvCacheBytes)} KV cache, ${formatGib(overheadBytes)} overhead).`,
    `${formatGib(availableBytes)} usable after a ${formatGib(SYSTEM_RESERVE_BYTES)} system reserve.`,
  ];
  if (totalBytes > availableBytes) {
    reasons.push("The model does not fit in the current memory budget.");
  }
  if (estimatedPrefillMs > 90_000) {
    reasons.push(
      "Prefill is likely too slow for an interactive agent; prefer a smaller model or cloud fallback.",
    );
  }

  return {
    fits: totalBytes <= availableBytes,
    availableBytes,
    requirements: {
      weightsBytes,
      kvCacheBytes,
      overheadBytes,
      totalBytes,
    },
    estimatedPrefillMs,
    estimatedDecodeTokensPerSecond,
    reasons,
  };
}

export function contextTokensFromChars(chars: number): number {
  return Math.max(1_024, Math.ceil(chars / 4));
}

function estimateWeightsBytes(model: string): number {
  const normalized = model.toLowerCase();
  const known = Object.entries(KNOWN_MODEL_BYTES).find(([id]) =>
    normalized.includes(id.toLowerCase()),
  );
  if (known) {
    return known[1];
  }
  const billions = estimateParameterBillions(model);
  // Approximate 4-bit weights plus a small margin for embeddings and scales.
  return billions * 0.75 * GIB;
}

function estimateKvCacheBytes(model: string, contextTokens: number): number {
  const billions = estimateParameterBillions(model);
  const perTokenGb = 0.000_06 + Math.min(billions, 40) * 0.000_001_5;
  return contextTokens * perTokenGb * GIB;
}

function estimateParameterBillions(model: string): number {
  const match = model.toLowerCase().match(/(\d+(?:\.\d+)?)\s*b/);
  if (match?.[1]) {
    return Number.parseFloat(match[1]);
  }
  if (/30b|32b|34b|35b/.test(model.toLowerCase())) {
    return 30;
  }
  return 7;
}

function formatGib(bytes: number): string {
  return `${(bytes / GIB).toFixed(1)} GB`;
}
