import { instant, plainDate, plainDateIn, userTimeZone, zoned, checkTimeZone, type InstantInput, type PlainDateInput } from "./core.js";
import { isPlainDate, type Temporal } from "./runtime.js";

type Locale = string | readonly string[];

export interface FormatInstantOptions extends Intl.DateTimeFormatOptions {
  /** BCP 47 locale, e.g. "en-GB". Defaults to the device locale. */
  locale?: Locale | undefined;
  /** IANA timezone to show the moment in. Defaults to the user's timezone. */
  timeZone?: string | undefined;
}

export type FormatDateOptions = Omit<
  Intl.DateTimeFormatOptions,
  "timeZone" | "timeStyle" | "hour" | "minute" | "second" | "fractionalSecondDigits" | "dayPeriod" | "hour12" | "hourCycle" | "timeZoneName"
> & {
  /** BCP 47 locale, e.g. "en-GB". Defaults to the device locale. */
  locale?: Locale | undefined;
};

export interface FormatRelativeOptions {
  /** Compare against this moment instead of the current time (useful for tests and SSR). */
  now?: InstantInput | undefined;
  locale?: Locale | undefined;
  /** "auto" gives "yesterday" / "now"; "always" gives "1 day ago" / "in 0 seconds". Default "auto". */
  numeric?: "auto" | "always" | undefined;
  style?: "long" | "short" | "narrow" | undefined;
  /** For calendar dates: whose "today" to compare against. Defaults to the user's timezone. */
  timeZone?: string | undefined;
}

const COMPONENT_KEYS = [
  "dateStyle",
  "timeStyle",
  "weekday",
  "era",
  "year",
  "month",
  "day",
  "dayPeriod",
  "hour",
  "minute",
  "second",
  "fractionalSecondDigits",
  "timeZoneName",
] as const;

const TIME_KEYS = ["timeStyle", "hour", "minute", "second", "fractionalSecondDigits", "dayPeriod", "hour12", "hourCycle", "timeZoneName"];

// Creating Intl formatters is slow, and lists/tables call format thousands of times.
const cache = new Map<string, Intl.DateTimeFormat | Intl.RelativeTimeFormat>();
function cached<T extends Intl.DateTimeFormat | Intl.RelativeTimeFormat>(key: string, create: () => T): T {
  let value = cache.get(key) as T | undefined;
  if (!value) {
    if (cache.size >= 100) cache.clear();
    value = create();
    cache.set(key, value);
  }
  return value;
}

const toLocales = (locale: Locale | undefined) => (locale === undefined ? undefined : ([] as string[]).concat(locale));

/**
 * Shows an exact moment in the user's timezone (or the one you pass).
 *
 * ```ts
 * formatInstant("2026-11-07T14:30:00Z", { locale: "en-GB", timeZone: "Asia/Kolkata" })
 * // "7 Nov 2026, 20:00"
 * ```
 */
export function formatInstant(value: InstantInput, options: FormatInstantOptions = {}): string {
  const { locale, ...rest } = options;
  const timeZone = rest.timeZone ?? userTimeZone();
  checkTimeZone(timeZone);
  const hasComponents = COMPONENT_KEYS.some((key) => rest[key] !== undefined);
  const intlOptions: Intl.DateTimeFormatOptions = hasComponents
    ? { ...rest, timeZone }
    : { dateStyle: "medium", timeStyle: "short", ...rest, timeZone };
  const formatter = cached(`dt|${String(locale)}|${JSON.stringify(intlOptions)}`, () => new Intl.DateTimeFormat(toLocales(locale), intlOptions));
  return formatter.format(instant(value).epochMilliseconds);
}

/**
 * Shows a calendar date. It shows the same day for every user, in every timezone.
 *
 * ```ts
 * formatDate("2026-11-07", { locale: "en-US" }) // "Nov 7, 2026"
 * ```
 */
export function formatDate(value: PlainDateInput, options: FormatDateOptions = {}): string {
  const { locale, ...rest } = options;
  const intlOptions: Intl.DateTimeFormatOptions = { ...rest };
  // Time parts make no sense for a calendar date, and a timezone would shift the day.
  for (const key of TIME_KEYS) delete (intlOptions as Record<string, unknown>)[key];
  if (!COMPONENT_KEYS.some((key) => intlOptions[key] !== undefined)) intlOptions.dateStyle = "medium";
  intlOptions.timeZone = "UTC";
  const formatter = cached(`d|${String(locale)}|${JSON.stringify(intlOptions)}`, () => new Intl.DateTimeFormat(toLocales(locale), intlOptions));
  return formatter.format(utcMidnight(plainDate(value)));
}

function utcMidnight(date: Temporal.PlainDate): number {
  const iso = date.withCalendar("iso8601");
  const d = new Date(0);
  d.setUTCFullYear(iso.year, iso.month - 1, iso.day); // avoids Date.UTC's 0–99 => 1900s quirk
  return d.getTime();
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "5 minutes ago", "in 3 hours", "yesterday", "in 2 weeks".
 *
 * Exact moments are compared with the current time. Calendar dates ("2026-11-07") are
 * compared with today's date in the user's timezone, so a date never reads "in 13 hours".
 */
export function formatRelative(value: InstantInput | Temporal.PlainDate, options: FormatRelativeOptions = {}): string {
  const { locale, numeric = "auto", style = "long" } = options;
  const rtf = cached(`rt|${String(locale)}|${numeric}|${style}`, () => new Intl.RelativeTimeFormat(toLocales(locale), { numeric, style }));
  const fmt = (n: number, unit: Intl.RelativeTimeFormatUnit) => rtf.format(n === 0 ? 0 : n, unit); // avoid "-0"

  const isCalendarDate = isPlainDate(value) || (typeof value === "string" && /^[+-]?\d{4,6}-\d{2}-\d{2}$/.test(value.trim()));
  if (isCalendarDate) {
    const timeZone = options.timeZone ?? userTimeZone();
    const target = plainDate(value as Temporal.PlainDate | string);
    const base = plainDateIn(options.now ?? Date.now(), timeZone);
    const days = base.until(target, { largestUnit: "days" }).days;
    if (Math.abs(days) < 7) return fmt(days, "day");
    const { years, months } = base.until(target, { largestUnit: "years" });
    const totalMonths = years * 12 + months;
    if (totalMonths === 0) return fmt(Math.round(days / 7), "week");
    if (Math.abs(totalMonths) < 12) return fmt(totalMonths, "month");
    return fmt(years, "year");
  }

  const base = options.now === undefined ? Date.now() : instant(options.now).epochMilliseconds;
  const diff = instant(value as InstantInput).epochMilliseconds - base;
  const abs = Math.abs(diff);
  if (abs < 45 * SECOND) return fmt(Math.round(diff / SECOND), "second");
  if (abs < 45 * MINUTE) return fmt(Math.round(diff / MINUTE), "minute");
  if (abs < 22 * HOUR) return fmt(Math.round(diff / HOUR), "hour");
  if (abs < 26 * DAY) return fmt(Math.round(diff / DAY), "day");
  if (abs < 320 * DAY) return fmt(Math.round(diff / (30.4375 * DAY)), "month");
  return fmt(Math.round(diff / (365.25 * DAY)), "year");
}

/** The moment shown as a ZonedDateTime in a timezone, for custom formatting. */
export function inTimeZone(value: InstantInput, timeZone: string = userTimeZone()): Temporal.ZonedDateTime {
  return zoned(instant(value), timeZone);
}
