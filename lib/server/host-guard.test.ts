import { describe, it, expect } from "vitest";
import { allowedHosts, checkRequest, hostname } from "./host-guard";

const hosts = allowedHosts("");

describe("local API host/origin guard", () => {
  it("allows same-origin browser requests and origin-less CLI requests on localhost", () => {
    expect(checkRequest("localhost:3000", "http://localhost:3000", hosts).ok).toBe(true);
    expect(checkRequest("127.0.0.1:3000", null, hosts).ok).toBe(true);
    expect(checkRequest("[::1]:3000", "http://[::1]:3000", hosts).ok).toBe(true);
  });

  it("blocks DNS-rebinding hosts", () => {
    expect(checkRequest("evil.example:3000", "http://evil.example:3000", hosts).ok).toBe(false);
    expect(checkRequest(null, null, hosts).ok).toBe(false);
  });

  it("blocks cross-origin and opaque origins", () => {
    expect(checkRequest("localhost:3000", "https://evil.example", hosts).ok).toBe(false);
    expect(checkRequest("localhost:3000", "http://localhost:4000", hosts).ok).toBe(false);
    expect(checkRequest("localhost:3000", "null", hosts).ok).toBe(false);
    expect(checkRequest("localhost:3000", "not a url", hosts).ok).toBe(false);
  });

  it("supports explicitly configured hosts", () => {
    expect(checkRequest("studio.lan:3000", "http://studio.lan:3000", allowedHosts("studio.lan")).ok).toBe(true);
    expect(hostname("Example.COM:80")).toBe("example.com");
  });
});
