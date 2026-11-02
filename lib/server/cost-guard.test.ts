import { describe, it, expect, beforeEach } from "vitest";
import {
  estimateCostUsd,
  guardCost,
  recordSpend,
  getBudgetState,
  resetBudget,
  reloadBudgetForTests,
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

describe("cost-guard: حجز ذري واستمرار", () => {
  beforeEach(() => {
    delete process.env.MONTAGE_BUDGET_FILE;
    resetBudget();
    process.env.MONTAGE_BUDGET_CAP = "0.1";
  });

  it("طلبات متزامنة لا تتجاوز السقف معاً (الحجز يُحتسب قبل التسجيل)", () => {
    // كل طلب ~0.06$ — الأول يُسمح ويُحجز، الثاني يُرفض قبل أن يسجّل الأول إنفاقه.
    const a = guardCost("whisper", { durationSec: 600 });
    const b = guardCost("whisper", { durationSec: 600 });
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(false);
    recordSpend(a.estimateUsd);
    expect(getBudgetState().spentUsd).toBeCloseTo(a.estimateUsd, 6);
  });

  it("الإنفاق يبقى بعد إعادة التحميل (إعادة تشغيل الخادم)", async () => {
    const os = await import("os");
    const fs = await import("fs");
    const path = await import("path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "budget-"));
    process.env.MONTAGE_BUDGET_FILE = path.join(dir, "budget.json");
    try {
      resetBudget();
      recordSpend(0.05);
      reloadBudgetForTests();
      expect(getBudgetState().spentUsd).toBeCloseTo(0.05, 6);
      expect(guardCost("whisper", { durationSec: 600 }).allowed).toBe(false);
    } finally {
      delete process.env.MONTAGE_BUDGET_FILE;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
