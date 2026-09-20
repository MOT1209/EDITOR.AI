import { describe, it, expect } from "vitest";
import {
  validateVideoUpload,
  validateAudioUpload,
  clampString,
  pickEnum,
  requireText,
} from "./validate";

describe("validate", () => {
  it("accepts a valid mp4 by mime or extension", () => {
    expect(validateVideoUpload({ name: "a.mp4", size: 1000, type: "video/mp4" }).ok).toBe(true);
    expect(validateVideoUpload({ name: "a.mov", size: 1000, type: "" }).ok).toBe(true);
  });

  it("rejects wrong type, empty, and oversized files", () => {
    expect(validateVideoUpload({ name: "a.txt", size: 1000, type: "text/plain" }).ok).toBe(false);
    expect(validateVideoUpload({ name: "a.mp4", size: 0 }).ok).toBe(false);
    expect(validateVideoUpload({ name: "a.mp4", size: 3e9, type: "video/mp4" }, 2e9).ok).toBe(false);
  });

  it("rejects a missing file", () => {
    expect(validateVideoUpload(null).ok).toBe(false);
    expect(validateAudioUpload(undefined).ok).toBe(false);
  });

  it("accepts audio by mime or extension", () => {
    expect(validateAudioUpload({ name: "a.mp3", size: 100, type: "audio/mpeg" }).ok).toBe(true);
    expect(validateAudioUpload({ name: "a.wav", size: 100, type: "" }).ok).toBe(true);
  });

  it("clampString caps length and coerces", () => {
    expect(clampString("x".repeat(50), 5)).toHaveLength(5);
    expect(clampString(undefined, 5, "def")).toBe("def");
  });

  it("pickEnum falls back on invalid value", () => {
    expect(pickEnum("16:9", ["9:16", "16:9"] as const, "9:16")).toBe("16:9");
    expect(pickEnum("bad", ["9:16", "16:9"] as const, "9:16")).toBe("9:16");
  });

  it("requireText enforces non-empty and caps", () => {
    expect(requireText("", "الحقل", 10).ok).toBe(false);
    const r = requireText("  hello world  ", "الحقل", 5);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("hello");
  });
});
