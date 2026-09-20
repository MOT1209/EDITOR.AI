import { describe, it, expect, beforeEach } from "vitest";
import {
  estimateCostUsd,
  guardCost,
  recordSpend,
  getBudgetState,
  resetBudget,
} from "./cost-guard";

describe("cost-guard", () => {
  beforeEach(() => {
    resetBudget();
    process.env.MONTAGE_BUDGET_CAP = "5";
    delete process.env.COST_CHAT_PER_1K;
  });

  it("estimates a positive cost for each kind", () => {
    expect(estimateCostUsd("whisper", { durationSec: 600 })).toBeGreaterThan(0);
    expect(estimateCostUsd("tts", { chars: 1000 })).toBeGreaterThan(0);
    expect(estimateCostUsd("chat", { chars: 4000 })).toBeGreaterThan(0);
    expect(estimateCostUsd("vision", { chars: 100, images: 2 })).toBeGreaterThan(
      estimateCostUsd("chat", { chars: 100 })
    );
  });

  it("allows a call under the cap and records spend", () => {
    const g = guardCost("tts", { chars: 500 });
    expect(g.allowed).toBe(true);
    recordSpend(g.estimateUsd);
    expect(getBudgetState().spentUsd).toBeCloseTo(g.estimateUsd, 6);
  });

  it("blocks a call that would exceed the cap", () => {
    process.env.MONTAGE_BUDGET_CAP = "0.01";
    recordSpend(0.009);
    const g = guardCost("whisper", { durationSec: 600 }); // ~0.06$
    expect(g.allowed).toBe(false);
    expect(g.reason).toBeTruthy();
  });

  it("treats cap<=0 as unlimited", () => {
    process.env.MONTAGE_BUDGET_CAP = "0";
    const g = guardCost("whisper", { durationSec: 1e6 });
    expect(g.allowed).toBe(true);
  });

  it("reads pricing overrides from env", () => {
    process.env.COST_CHAT_PER_1K = "1";
    // 4000 chars = 1000 tokens = 1 unit → 1 * 1 = 1.0
    expect(estimateCostUsd("chat", { chars: 4000 })).toBeCloseTo(1.0, 6);
  });
});
