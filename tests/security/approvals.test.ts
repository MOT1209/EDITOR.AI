import { beforeEach, describe, expect, it } from "vitest";
import { _resetApprovals, consumeApproval, requestApproval } from "@/lib/server/approvals";
import { uiApprover } from "@/lib/server/ext-api";

beforeEach(() => _resetApprovals());

describe("server-side approval handshake", () => {
  it("a blind confirmed:true (no prior pending request) is refused", async () => {
    await expect(uiApprover(true, "tool:x")({ action: "fs.write", summary: "s" })).rejects.toMatchObject({ code: "APPROVAL_DENIED" });
  });
  it("unconfirmed attempt registers a pending approval; confirmed retry succeeds exactly once", async () => {
    const ap = (c: boolean) => uiApprover(c, "tool:x")({ action: "fs.write", summary: "s" });
    await expect(ap(false)).rejects.toMatchObject({ code: "APPROVAL_DENIED" });
    await expect(ap(true)).resolves.toBeUndefined();
    await expect(ap(true)).rejects.toMatchObject({ code: "APPROVAL_DENIED" }); // single-use
  });
  it("approval is bound to scope and action", async () => {
    await expect(uiApprover(false, "tool:a")({ action: "act1", summary: "" })).rejects.toBeTruthy();
    await expect(uiApprover(true, "tool:b")({ action: "act1", summary: "" })).rejects.toBeTruthy();
    await expect(uiApprover(true, "tool:a")({ action: "act2", summary: "" })).rejects.toBeTruthy();
  });
  it("pending approvals expire", () => {
    requestApproval("k", 1000);
    expect(consumeApproval("k", 1000 + 6 * 60_000)).toBe(false);
    requestApproval("k2", 1000);
    expect(consumeApproval("k2", 1000 + 1000)).toBe(true);
  });
});
