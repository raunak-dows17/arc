import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ToolValidationError } from "../../domain/errors/agent.errors.js";

export type HostResolver = (hostname: string) => Promise<readonly string[]>;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "instance-data",
]);

const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".home",
  ".lan",
  ".intranet",
  ".corp",
];

const DEFAULT_PORTS = new Set(["", "80", "443"]);

const defaultResolver: HostResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => entry.address);
};

/**
 * Reject non-public HTTP(S) destinations before a request is made. This is a
 * defence against SSRF, including loopback, link-local metadata services,
 * private networks, and DNS names that resolve into them.
 *
 * Redirects are checked separately by the caller; every hop must pass this
 * function.
 */
export async function assertPublicHttpUrl(
  input: string,
  resolveHost: HostResolver = defaultResolver,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ToolValidationError(`Invalid URL: "${input}".`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ToolValidationError(
      "Only http:// and https:// URLs can be fetched.",
    );
  }
  if (url.username || url.password) {
    throw new ToolValidationError(
      "URLs containing embedded credentials are not allowed.",
    );
  }
  if (!DEFAULT_PORTS.has(url.port)) {
    throw new ToolValidationError(
      "Only default HTTP/HTTPS ports (80 and 443) are allowed.",
    );
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) {
    throw new ToolValidationError("The URL has no hostname.");
  }
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new ToolValidationError(
      `Fetching "${hostname}" is blocked because it is a local address.`,
    );
  }
  if (BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new ToolValidationError(
      `Fetching "${hostname}" is blocked because it is a local address.`,
    );
  }

  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [hostname]
    : await resolveHostSafely(hostname, resolveHost);

  if (addresses.length === 0) {
    throw new ToolValidationError(
      `Could not resolve "${hostname}" to a public address.`,
    );
  }
  for (const address of addresses) {
    if (!isPublicAddress(address)) {
      throw new ToolValidationError(
        `Fetching "${hostname}" is blocked because it resolves to a private or reserved address (${address}).`,
      );
    }
  }

  return url;
}

export function isPublicAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  const family = isIP(normalized);
  if (family === 4) {
    return isPublicIpv4(normalized);
  }
  if (family === 6) {
    return isPublicIpv6(normalized);
  }
  return false;
}

async function resolveHostSafely(
  hostname: string,
  resolveHost: HostResolver,
): Promise<readonly string[]> {
  try {
    return await resolveHost(hostname);
  } catch (error) {
    throw new ToolValidationError(
      `Could not resolve "${hostname}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizeHostname(hostname: string): string {
  const withoutBrackets =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  return withoutBrackets.toLowerCase().replace(/\.$/, "");
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a = 0, b = 0, c = 0] = parts;

  if (a === 0 || a === 10 || a === 127 || a >= 224) {
    return false;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return false;
  }
  if (a === 169 && b === 254) {
    return false;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return false;
  }
  if (a === 192 && b === 168) {
    return false;
  }
  if (a === 192 && b === 0 && (c === 0 || c === 2)) {
    return false;
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return false;
  }
  if (a === 198 && b === 51 && c === 100) {
    return false;
  }
  if (a === 203 && b === 0 && c === 113) {
    return false;
  }
  if (a === 255 && b === 255 && c === 255) {
    return false;
  }
  return true;
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") {
    return false;
  }
  if (normalized.startsWith("::ffff:")) {
    // IPv4-mapped addresses are blocked wholesale; parsing every textual form
    // of the embedded IPv4 address is not worth the SSRF risk.
    return false;
  }
  if (
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("ff")
  ) {
    return false;
  }
  if (
    normalized.startsWith("2001:db8:") ||
    normalized.startsWith("2001:0:") ||
    normalized.startsWith("2002:")
  ) {
    return false;
  }

  const first = normalized.split(":")[0] ?? "";
  const value = Number.parseInt(first, 16);
  if (!Number.isFinite(value)) {
    return false;
  }
  // Global unicast is 2000::/3.
  return value >= 0x2000 && value <= 0x3fff;
}
