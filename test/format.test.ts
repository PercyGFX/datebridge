import { describe, expect, it } from "vitest";
import { formatDate, formatInstant, formatRelative, inTimeZone } from "../src/index.js";

const TZ = process.env.TZ ?? "(system)";
// ICU versions differ in which space they put before AM/PM (U+202F vs a normal space).
const norm = (s: string) => s.replace(/[  ]/g, " ");

describe(`formatDate() [TZ=${TZ}]`, () => {
  it("shows the same calendar day in every timezone", () => {
    expect(formatDate("2026-11-07", { locale: "en-US" })).toBe("Nov 7, 2026");
    expect(formatDate("2026-01-01", { locale: "en-US", dateStyle: "full" })).toBe("Thursday, January 1, 2026");
    expect(formatDate(Temporal.PlainDate.from("2026-12-31"), { locale: "en-GB" })).toBe("31 Dec 2026");
  });

  it("ignores time and timezone options, which would shift or pad the day", () => {
    const options = { locale: "en-US", month: "short", day: "numeric", hour: "numeric", timeZone: "Pacific/Kiritimati" } as never;
    expect(formatDate("2026-11-07", options)).toBe("Nov 7");
  });

  it("handles years before 100", () => {
    expect(formatDate({ year: 50, month: 6, day: 1 }, { locale: "en-US", year: "numeric", month: "long", day: "numeric" })).toBe(
      "June 1, 50",
    );
  });
});

describe(`formatInstant() [TZ=${TZ}]`, () => {
  const moment = "2026-11-07T14:30:00Z";

  it("shows the moment in the timezone you ask for", () => {
    expect(norm(formatInstant(moment, { locale: "en-US", timeZone: "UTC" }))).toBe("Nov 7, 2026, 2:30 PM");
    expect(norm(formatInstant(moment, { locale: "en-US", timeZone: "Asia/Kolkata" }))).toBe("Nov 7, 2026, 8:00 PM");
    expect(norm(formatInstant(moment, { locale: "en-US", timeZone: "Pacific/Kiritimati" }))).toBe("Nov 8, 2026, 4:30 AM");
  });

  it("accepts Intl options", () => {
    expect(formatInstant(moment, { locale: "en-GB", timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })).toBe("14:30");
    expect(formatInstant(moment, { locale: "en-US", timeZone: "UTC", dateStyle: "long" })).toBe("November 7, 2026");
  });

  it("defaults to the user's timezone", () => {
    const expected = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(moment));
    expect(formatInstant(moment, { locale: "en-US" })).toBe(expected);
  });

  it("rejects unknown timezones", () => {
    expect(() => formatInstant(moment, { timeZone: "Nowhere/Land" })).toThrow(/Unknown timezone/);
  });
});

describe(`formatRelative() [TZ=${TZ}]`, () => {
  const base = "2026-11-07T12:00:00Z";
  const at = (ms: number) => new Date(Date.parse(base) + ms);
  const rel = (value: Parameters<typeof formatRelative>[0], extra = {}) =>
    formatRelative(value, { now: base, locale: "en-US", ...extra });

  it("describes moments", () => {
    expect(rel(at(0))).toBe("now");
    expect(rel(at(-5 * 60_000))).toBe("5 minutes ago");
    expect(rel(at(3 * 3_600_000))).toBe("in 3 hours");
    expect(rel(at(-24 * 3_600_000))).toBe("yesterday");
    expect(rel(at(-24 * 3_600_000), { numeric: "always" })).toBe("1 day ago");
    expect(rel(at(60 * 86_400_000))).toBe("in 2 months");
    expect(rel(at(-400 * 86_400_000))).toBe("last year");
  });

  it("compares calendar dates by day, in the user's timezone", () => {
    expect(rel("2026-11-07", { timeZone: "UTC" })).toBe("today");
    expect(rel("2026-11-08", { timeZone: "UTC" })).toBe("tomorrow");
    expect(rel("2026-11-04", { timeZone: "UTC" })).toBe("3 days ago");
    expect(rel("2026-11-21", { timeZone: "UTC" })).toBe("in 2 weeks");
    expect(rel("2026-12-06", { timeZone: "UTC" })).toBe("in 4 weeks");
    expect(rel("2027-02-07", { timeZone: "UTC" })).toBe("in 3 months");
    expect(rel("2029-11-07", { timeZone: "UTC" })).toBe("in 3 years");
    // At 12:00 UTC it's already Nov 8 in Kiritimati, so Nov 8 is "today" there.
    expect(rel("2026-11-08", { timeZone: "Pacific/Kiritimati" })).toBe("today");
  });
});

describe("inTimeZone()", () => {
  it("returns a ZonedDateTime for custom formatting", () => {
    const zdt = inTimeZone("2026-11-07T14:30:00Z", "Asia/Tokyo");
    expect(zdt.hour).toBe(23);
    expect(zdt.timeZoneId).toBe("Asia/Tokyo");
  });
});
