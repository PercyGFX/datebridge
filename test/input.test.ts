import { describe, expect, it } from "vitest";
import { fromDateInput, fromDateTimeInput, toDateInput, toDateTimeInput } from "../src/index.js";

const TZ = process.env.TZ ?? "(system)";

describe(`<input type="date"> [TZ=${TZ}]`, () => {
  it("round-trips the picked day, never shifting it", () => {
    const picked = fromDateInput("2026-11-07");
    expect(picked?.toString()).toBe("2026-11-07");
    expect(toDateInput(picked)).toBe("2026-11-07");
  });

  it("treats an empty input as null", () => {
    expect(fromDateInput("")).toBeNull();
    expect(fromDateInput(undefined)).toBeNull();
    expect(toDateInput(null)).toBe("");
  });

  it("accepts strings, so a server value can fill the input directly", () => {
    expect(toDateInput("2026-11-07")).toBe("2026-11-07");
  });
});

describe(`<input type="datetime-local"> [TZ=${TZ}]`, () => {
  it("reads wall-clock time in the given timezone", () => {
    expect(fromDateTimeInput("2026-11-07T20:00", "Asia/Kolkata")?.toString()).toBe("2026-11-07T14:30:00Z");
    expect(fromDateTimeInput("2026-11-07T14:30", "UTC")?.toString()).toBe("2026-11-07T14:30:00Z");
  });

  it("moves times skipped by daylight saving forward", () => {
    // 02:30 doesn't exist in New York on 2026-03-08; clocks jump from 02:00 to 03:00.
    expect(fromDateTimeInput("2026-03-08T02:30", "America/New_York")?.toString()).toBe("2026-03-08T07:30:00Z");
  });

  it("writes a value the input understands", () => {
    expect(toDateTimeInput("2026-11-07T14:30:00Z", "Asia/Kolkata")).toBe("2026-11-07T20:00");
    expect(toDateTimeInput("2026-11-07T14:30:05Z", "UTC", { seconds: true })).toBe("2026-11-07T14:30:05");
    expect(toDateTimeInput(null)).toBe("");
  });

  it("rejects garbage", () => {
    expect(fromDateTimeInput("")).toBeNull();
    expect(() => fromDateTimeInput("7 Nov", "UTC")).toThrow(/datetime-local/);
    expect(() => fromDateTimeInput("2026-11-07T14:30", "Bad/Zone")).toThrow(/Unknown timezone/);
  });
});
