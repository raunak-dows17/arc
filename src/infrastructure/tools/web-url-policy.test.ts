import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolValidationError } from "../../domain/errors/agent.errors.js";
import {
  assertPublicHttpUrl,
  isPublicAddress,
} from "./web-url-policy.js";

const publicResolver = async (): Promise<string[]> => ["93.184.216.34"];

describe("web URL policy", () => {
  it("allows public HTTP(S) URLs", async () => {
    const url = await assertPublicHttpUrl(
      "https://example.com/docs?q=arc",
      publicResolver,
    );
    assert.equal(url.hostname, "example.com");
  });

  it("blocks loopback, private, link-local, and metadata addresses", async () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1",
    ]) {
      assert.equal(isPublicAddress(address), false, address);
    }
  });

  it("blocks local hostnames and non-default ports", async () => {
    await assert.rejects(
      assertPublicHttpUrl("http://localhost:8080", publicResolver),
      ToolValidationError,
    );
    await assert.rejects(
      assertPublicHttpUrl("https://printer.local", publicResolver),
      ToolValidationError,
    );
    await assert.rejects(
      assertPublicHttpUrl("https://example.com:8443", publicResolver),
      /default HTTP\/HTTPS ports/,
    );
  });

  it("rejects a public hostname that resolves to a private address", async () => {
    await assert.rejects(
      assertPublicHttpUrl("https://evil.example", async () => ["127.0.0.1"]),
      /private or reserved address/,
    );
  });

  it("rejects credentials, non-HTTP schemes, and resolver failures", async () => {
    await assert.rejects(
      assertPublicHttpUrl("https://user:pass@example.com", publicResolver),
      /embedded credentials/,
    );
    await assert.rejects(
      assertPublicHttpUrl("file:///etc/passwd", publicResolver),
      /Only http/,
    );
    await assert.rejects(
      assertPublicHttpUrl("https://example.com", async () => {
        throw new Error("ENOTFOUND");
      }),
      /Could not resolve/,
    );
  });
});
