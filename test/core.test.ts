import { afterEach, describe, expect, it } from "vitest";
import {
  configure,
  DateBridgeError,
  dayRange,
  instant,
  isInstant,
  isPlainDate,
  now,
  plainDate,
  plainDateIn,
  toDate,
  today,
  userTimeZone,
} from "../src/index.js";

const TZ = process.env.TZ ?? "(system)";

describe(`instant() [TZ=${TZ}]`, () => {
  it("reads ISO strings with Z or an offset", () => {
    expect(instant("2026-11-07T14:30:00Z").toString()).toBe("2026-11-07T14:30:00Z");
    expect(instant("2026-11-07T20:00:00+05:30").toString()).toBe("2026-11-07T14:30:00Z");
    expect(instant("  2026-11-07T14:30:00.123Z ").epochMilliseconds).toBe(Date.UTC(2026, 10, 7, 14, 30, 0, 123));
  });

  it("reads Postgres timestamptz text", () => {
    expect(instant("2026-11-07 14:30:00+00").toString()).toBe("2026-11-07T14:30:00Z");
    expect(instant("2026-11-07 14:30:00.123456-05").toString()).toBe("2026-11-07T19:30:00.123456Z");
  });

  it("reads Date, epoch ms, ZonedDateTime and Instant", () => {
    const ms = Date.UTC(2026, 10, 7, 14, 30);
    expect(instant(new Date(ms)).epochMilliseconds).toBe(ms);
    expect(instant(ms).epochMilliseconds).toBe(ms);
    const zdt = Temporal.ZonedDateTime.from("2026-11-07T09:30:00-05:00[America/New_York]");
    expect(instant(zdt).epochMilliseconds).toBe(ms);
    const i = Temporal.Instant.fromEpochMilliseconds(ms);
    expect(instant(i)).toBe(i);
  });

  it("refuses values that aren't one exact moment, and says what to do", () => {
    expect(() => instant("2026-11-07")).toThrow(/calendar date.*plainDate/);
    expect(() => instant("2026-11-07T14:30")).toThrow(/no timezone/);
    expect(() => instant("next tuesday")).toThrow(DateBridgeError);
    expect(() => instant(new Date("nope"))).toThrow(/Invalid Date/);
    expect(() => instant(1.5)).toThrow(/whole number/);
    expect(() => instant({} as never)).toThrow(DateBridgeError);
  });
});

describe(`plainDate() [TZ=${TZ}]`, () => {
  it("reads YYYY-MM-DD and objects", () => {
    expect(plainDate("2026-11-07").toString()).toBe("2026-11-07");
    expect(plainDate({ year: 2026, month: 11, day: 7 }).toString()).toBe("2026-11-07");
  });

  it("rejects dates that don't exist", () => {
    expect(() => plainDate("2026-02-30")).toThrow(/not a real calendar date/);
    expect(() => plainDate({ year: 2026, month: 2, day: 30 })).toThrow(/not a real calendar date/);
  });

  it("refuses timestamps, which are how day-shift bugs arrive", () => {
    // A user in UTC+5:30 picked Nov 7; buggy code sent local midnight as UTC.
    expect(() => plainDate("2026-11-06T18:30:00.000Z")).toThrow(/timestamp, not a calendar date.*plainDateIn/);
  });

  it("accepts exact UTC midnight (what Prisma @db.Date and many APIs send)", () => {
    expect(plainDate("2026-11-07T00:00:00.000Z").toString()).toBe("2026-11-07");
    expect(plainDate("2026-11-07T00:00:00Z").toString()).toBe("2026-11-07");
    expect(plainDate(new Date(Date.UTC(2026, 10, 7))).toString()).toBe("2026-11-07");
  });

  it("accepts midnight at any offset (Go's time.Time JSON for date columns)", () => {
    expect(plainDate("2026-11-07T00:00:00+00:00").toString()).toBe("2026-11-07");
    expect(plainDate("2026-11-07T00:00:00+05:30").toString()).toBe("2026-11-07");
    expect(plainDate("2026-11-07T00:00:00-05:00").toString()).toBe("2026-11-07");
    // Not midnight: still refused, because its day depends on the timezone.
    expect(() => plainDate("2026-11-07T00:00:00.001Z")).toThrow(/timestamp/);
    expect(() => plainDate("2026-11-06T18:30:00+00:00")).toThrow(/timestamp/);
  });

  it("reads a date picker's local-midnight Date as the day the user picked, in every timezone", () => {
    expect(plainDate(new Date(2026, 10, 7)).toString()).toBe("2026-11-07");
    expect(plainDate(new Date(2026, 0, 1)).toString()).toBe("2026-01-01");
  });

  it("handles date pickers on days where daylight saving skips midnight", () => {
    const saved = process.env.TZ;
    process.env.TZ = "America/Santiago"; // 2026-09-06 00:00 doesn't exist; the day starts at 01:00
    try {
      const picked = new Date(2026, 8, 6);
      expect(picked.getHours()).toBe(1);
      expect(plainDate(picked).toString()).toBe("2026-09-06");
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  it("refuses a Date with a time of day", () => {
    expect(() => plainDate(new Date(Date.UTC(2026, 10, 7, 14, 30, 7)))).toThrow(/time of day/);
  });

  it("reads Postgres BC and 5-digit years", () => {
    expect(plainDate("0044-03-15 BC").year).toBe(-43);
    expect(plainDate("10000-01-01").year).toBe(10000);
  });
});

describe(`plainDateIn() and dayRange() [TZ=${TZ}]`, () => {
  it("gives the day a moment falls on in a timezone", () => {
    const moment = "2026-11-07T20:00:00Z";
    expect(plainDateIn(moment, "Europe/London").toString()).toBe("2026-11-07");
    expect(plainDateIn(moment, "Asia/Tokyo").toString()).toBe("2026-11-08");
    expect(plainDateIn(moment, "Pacific/Pago_Pago").toString()).toBe("2026-11-07");
  });

  it("returns the exact start and end of a day", () => {
    const { start, end } = dayRange("2026-11-07", "Asia/Kolkata");
    expect(start.toString()).toBe("2026-11-06T18:30:00Z");
    expect(end.toString()).toBe("2026-11-07T18:30:00Z");
  });

  it("handles 23- and 25-hour days around daylight saving", () => {
    const spring = dayRange("2026-03-08", "America/New_York");
    expect((spring.end.epochMilliseconds - spring.start.epochMilliseconds) / 3_600_000).toBe(23);
    const fall = dayRange("2026-11-01", "America/New_York");
    expect((fall.end.epochMilliseconds - fall.start.epochMilliseconds) / 3_600_000).toBe(25);
  });

  it("rejects unknown timezones with a clear message", () => {
    expect(() => dayRange("2026-11-07", "Mars/Olympus")).toThrow(/Unknown timezone "Mars\/Olympus"/);
    expect(() => plainDateIn(0, "Mars/Olympus")).toThrow(/Unknown timezone/);
  });
});

describe("now, today, userTimeZone, toDate, guards", () => {
  it("work", () => {
    expect(isInstant(now())).toBe(true);
    expect(isPlainDate(today("UTC"))).toBe(true);
    expect(typeof userTimeZone()).toBe("string");
    expect(toDate("2026-11-07T14:30:00Z").toISOString()).toBe("2026-11-07T14:30:00.000Z");
    expect(isInstant("2026-11-07T14:30:00Z")).toBe(false);
    expect(isPlainDate(new Date())).toBe(false);
  });
});

describe("missing Temporal", () => {
  const original = globalThis.Temporal;
  afterEach(() => {
    globalThis.Temporal = original;
    configure({ Temporal: undefined });
  });

  it("explains how to add the polyfill", () => {
    // @ts-expect-error simulate a browser without Temporal
    delete globalThis.Temporal;
    expect(() => now()).toThrow(/temporal-polyfill\/global/);
  });

  it("can use a configured implementation instead of the global", () => {
    // @ts-expect-error simulate a browser without Temporal
    delete globalThis.Temporal;
    configure({ Temporal: original });
    expect(isInstant(now())).toBe(true);
  });
});
