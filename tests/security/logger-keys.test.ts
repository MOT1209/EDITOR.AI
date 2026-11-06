import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { formatLog, redact } from "@/lib/server/logger";
import { clientKeysAccepted, getOpencodeKey } from "@/lib/server/api-keys";

describe("structured logger redaction", () => {
  it("redacts secret-looking keys and values", () => {
    const line = formatLog("info", "t", { apiKey: "abc", nested: { Authorization: "Bearer zzzzzzzzzzzz", ok: 1 }, msg: "failed with sk-ABCDEFGH12345678 and hf_abcdefgh1234" });
    const o = JSON.parse(line);
    expect(o.apiKey).toBe("[REDACTED]");
    expect(o.nested.Authorization).toBe("[REDACTED]");
    expect(o.nested.ok).toBe(1);
    expect(line).not.toMatch(/sk-ABCDEFGH|hf_abcdefgh|zzzzzzzz/);
    expect(o.level).toBe("info");
    expect(typeof o.ts).toBe("string");
  });
  it("redacts inside Error messages and bounds depth", () => {
    expect(JSON.stringify(redact(new Error("boom sk-ABCDEFGH12345678")))).not.toMatch(/sk-ABCDEFGH/);
  });
});

describe("provider keys never trusted from the browser in remote deployments", () => {
  it("accepts client keys only for local deployments", () => {
    expect(clientKeysAccepted({} as NodeJS.ProcessEnv)).toBe(true);
    expect(clientKeysAccepted({ MONTAGE_ALLOWED_HOSTS: "studio.example.com" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(clientKeysAccepted({ MONTAGE_ACCEPT_CLIENT_KEYS: "0" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
  it("getOpencodeKey ignores the header when disabled", () => {
    const prev = { a: process.env.MONTAGE_ACCEPT_CLIENT_KEYS, k: process.env.OPENCODE_API_KEY };
    process.env.MONTAGE_ACCEPT_CLIENT_KEYS = "0";
    delete process.env.OPENCODE_API_KEY;
    const req = new NextRequest("http://localhost/x", { headers: { "x-opencode-key": "client-supplied" } });
    expect(getOpencodeKey(req)).toBeUndefined();
    process.env.MONTAGE_ACCEPT_CLIENT_KEYS = prev.a as string;
    if (prev.a === undefined) delete process.env.MONTAGE_ACCEPT_CLIENT_KEYS;
    if (prev.k !== undefined) process.env.OPENCODE_API_KEY = prev.k;
  });
});
