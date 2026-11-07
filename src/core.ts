import { parsePgDate, parsePgTimestamptz } from "./internal/postgres.js";
import {
  DateBridgeError,
  describe,
  getTemporal,
  isDate,
  isInstant,
  isPlainDate,
  isZonedDateTime,
  type Temporal,
} from "./runtime.js";

/**
 * Anything that means one exact moment: a Temporal.Instant or ZonedDateTime, a Date,
 * epoch milliseconds, or an ISO string with "Z" or an offset.
 */
export type InstantInput = Temporal.Instant | Temporal.ZonedDateTime | Date | string | number;

/**
 * Anything that means one calendar day: a Temporal.PlainDate, a "YYYY-MM-DD" string,
 * `{ year, month, day }`, or a Date at exactly midnight (see {@link plainDate}).
 */
export type PlainDateInput = Temporal.PlainDate | Date | string | { year: number; month: number; day: number };

const DATE_ONLY = /^[+-]?\d{4,6}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME = /^[+-]?\d{4,6}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
// Exactly midnight, with "Z" or any offset: "2026-11-07T00:00:00Z", "...T00:00:00+00:00" (Go),
// "...T00:00:00+05:30". Whoever wrote it meant the date written in it.
const MIDNIGHT = /^([+-]?\d{4,6}-\d{2}-\d{2})T00:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Converts a value to a `Temporal.Instant` (an exact moment, like "bet placed at").
 *
 * Throws a helpful error for strings with no timezone, such as "2026-11-07" or
 * "2026-11-07T14:30", because they don't name a single moment.
 */
export function instant(value: InstantInput): Temporal.Instant {
  const T = getTemporal();
  if (isInstant(value)) return value;
  if (isZonedDateTime(value)) return value.toInstant();
  if (isDate(value)) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) throw new DateBridgeError("Cannot convert an Invalid Date to an instant.");
    return T.Instant.fromEpochMilliseconds(ms);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new DateBridgeError(`Expected epoch milliseconds as a whole number, got ${value}.`);
    }
    return T.Instant.fromEpochMilliseconds(value);
  }
  if (typeof value === "string") return parseInstant(value);
  throw new DateBridgeError(
    `Expected an exact moment (Temporal.Instant, Date, ISO string or epoch milliseconds), got ${describe(value)}.`,
  );
}

function parseInstant(input: string): Temporal.Instant {
  const text = input.trim();
  try {
    return getTemporal().Instant.from(text);
  } catch {
    // fall through to Postgres format and friendlier errors
  }
  try {
    const pg = parsePgTimestamptz(text);
    if (typeof pg !== "string") return pg;
  } catch {
    // not Postgres format either
  }
  if (DATE_ONLY.test(text)) {
    throw new DateBridgeError(
      `${JSON.stringify(input)} is a calendar date, not an exact moment. Use plainDate(${JSON.stringify(input)}) instead.`,
    );
  }
  if (LOCAL_DATE_TIME.test(text)) {
    throw new DateBridgeError(
      `${JSON.stringify(input)} has no timezone, so it doesn't name one exact moment. ` +
        'Send it with "Z" or an offset (e.g. "2026-11-07T14:30:00Z"), or use fromDateTimeInput(value, timeZone).',
    );
  }
  throw new DateBridgeError(
    `Cannot read ${JSON.stringify(input)} as an exact moment. Expected an ISO 8601 string with "Z" or an offset, ` +
      'e.g. "2026-11-07T14:30:00Z".',
  );
}

/**
 * Converts a value to a `Temporal.PlainDate` (a calendar day with no timezone, like a
 * birthday or "promo ends Nov 30"). It can't shift to the day before or after.
 *
 * - `"2026-11-07"`, `{ year, month, day }` and PlainDate are read as-is.
 * - An ISO string at exactly midnight, with "Z" or any offset, gives the date written in it.
 *   This is how Prisma, Go and many APIs send date columns.
 * - A Date at exactly **UTC** midnight (what Prisma returns for date columns) gives that UTC day.
 * - A Date at exactly **local** midnight (what most date pickers return) gives that local day.
 * - Anything with a real time of day throws, because its day depends on the timezone.
 *   Use {@link plainDateIn} for that.
 */
export function plainDate(value: PlainDateInput): Temporal.PlainDate {
  const T = getTemporal();
  if (isPlainDate(value)) return value;
  if (typeof value === "string") return parsePlainDate(value);
  if (isDate(value)) return plainDateFromMidnight(value);
  if (value !== null && typeof value === "object" && "year" in value && "month" in value && "day" in value) {
    try {
      return T.PlainDate.from({ year: value.year, month: value.month, day: value.day }, { overflow: "reject" });
    } catch {
      throw new DateBridgeError(`${value.year}-${value.month}-${value.day} is not a real calendar date.`);
    }
  }
  throw new DateBridgeError(
    `Expected a calendar date (Temporal.PlainDate, "YYYY-MM-DD" or { year, month, day }), got ${describe(value)}.`,
  );
}

function parsePlainDate(input: string): Temporal.PlainDate {
  const text = input.trim();
  const T = getTemporal();
  const midnight = MIDNIGHT.exec(text);
  const dateText = midnight ? midnight[1]! : text;
  const fromPostgres = (value: string) => {
    try {
      const pg = parsePgDate(value); // "0044-03-15 BC", "10000-01-01"
      return typeof pg === "string" ? undefined : pg;
    } catch {
      return undefined;
    }
  };
  if (DATE_ONLY.test(dateText)) {
    try {
      return T.PlainDate.from(dateText);
    } catch {
      const pg = fromPostgres(dateText);
      if (pg) return pg;
      throw new DateBridgeError(`${JSON.stringify(input)} is not a real calendar date.`);
    }
  }
  const pg = fromPostgres(text);
  if (pg) return pg;
  if (/\d{2}:\d{2}/.test(text)) {
    throw new DateBridgeError(
      `${JSON.stringify(input)} is a timestamp, not a calendar date. Which day it falls on depends on the timezone: ` +
        "use plainDateIn(value, timeZone).",
    );
  }
  throw new DateBridgeError(`Cannot read ${JSON.stringify(input)} as a calendar date. Expected "YYYY-MM-DD".`);
}

function plainDateFromMidnight(date: Date): Temporal.PlainDate {
  const T = getTemporal();
  if (Number.isNaN(date.getTime())) throw new DateBridgeError("Cannot convert an Invalid Date to a calendar date.");
  // "Start of the local day", built the same way date pickers build it. Usually 00:00, but
  // 01:00 on days where daylight saving skips midnight (e.g. Chile, Paraguay).
  const localDayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  localDayStart.setFullYear(date.getFullYear()); // years 0–99
  if (localDayStart.getTime() === date.getTime()) {
    return T.PlainDate.from({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
  }
  if (date.getTime() % 86_400_000 === 0) {
    return T.PlainDate.from({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
  }
  throw new DateBridgeError(
    `${describe(date)} has a time of day, so which calendar day it falls on depends on the timezone. ` +
      "Use plainDateIn(date, timeZone).",
  );
}

/** The calendar day an exact moment falls on in a timezone. */
export function plainDateIn(value: InstantInput, timeZone: string): Temporal.PlainDate {
  return zoned(instant(value), timeZone).toPlainDate();
}

/**
 * The exact start and end of a calendar day in a timezone, as `[start, end)`.
 * Handles days that are 23 or 25 hours long because of daylight saving time.
 *
 * ```ts
 * const { start, end } = dayRange("2026-11-07", "Europe/London");
 * // SQL: WHERE placed_at >= start AND placed_at < end
 * ```
 */
export function dayRange(date: PlainDateInput, timeZone: string): { start: Temporal.Instant; end: Temporal.Instant } {
  const day = plainDate(date);
  checkTimeZone(timeZone);
  return {
    start: day.toZonedDateTime(timeZone).toInstant(),
    end: day.add({ days: 1 }).toZonedDateTime(timeZone).toInstant(),
  };
}

/** The current exact moment. */
export function now(): Temporal.Instant {
  return getTemporal().Now.instant();
}

/** Today's date in a timezone (defaults to the user's or server's timezone). */
export function today(timeZone: string = userTimeZone()): Temporal.PlainDate {
  checkTimeZone(timeZone);
  return getTemporal().Now.plainDateISO(timeZone);
}

/** The current device's IANA timezone, e.g. "Europe/London". On servers, this is the server's zone. */
export function userTimeZone(): string {
  return getTemporal().Now.timeZoneId();
}

/** Converts to a legacy `Date`, for libraries that still need one. */
export function toDate(value: InstantInput): Date {
  return new Date(instant(value).epochMilliseconds);
}

/** @internal */
export function zoned(value: Temporal.Instant, timeZone: string): Temporal.ZonedDateTime {
  checkTimeZone(timeZone);
  return value.toZonedDateTimeISO(timeZone);
}

const knownTimeZones = new Set<string>();

/** @internal */
export function checkTimeZone(timeZone: string): void {
  if (knownTimeZones.has(timeZone)) return;
  try {
    getTemporal().Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(timeZone);
    if (knownTimeZones.size < 500) knownTimeZones.add(timeZone);
  } catch {
    throw new DateBridgeError(
      `Unknown timezone ${JSON.stringify(timeZone)}. Use an IANA name like "Europe/London" or "America/New_York".`,
    );
  }
}
