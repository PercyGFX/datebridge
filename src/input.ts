// Helpers for <input type="date"> and <input type="datetime-local">.
// Their `.value` is a plain string; never use `.valueAsDate`, which is UTC midnight.

import {
  instant,
  isCalendarLibraryValue,
  plainDate,
  userTimeZone,
  zoned,
  checkTimeZone,
  type CalendarLibraryValue,
  type InstantInput,
  type PlainDateInput,
} from "./core.js";
import { DateBridgeError, getTemporal, type Temporal } from "./runtime.js";

/** `<input type="date">` value ("2026-11-07" or "") -> PlainDate or null. */
export function fromDateInput(value: string | null | undefined): Temporal.PlainDate | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  return plainDate(value);
}

/**
 * Calendar date -> the `Date` that date pickers expect: the start of that day in the user's
 * timezone. Use it to set the value of `Date`-based pickers (shadcn/ui Calendar,
 * react-day-picker, react-datepicker).
 *
 * Don't use `new Date("2026-11-07")` for this: it gives UTC midnight, which pickers show as
 * Nov 6 for users west of UTC.
 */
export function toPickerDate(value: PlainDateInput): Date;
export function toPickerDate(value: PlainDateInput | null | undefined): Date | undefined;
export function toPickerDate(value: PlainDateInput | null | undefined): Date | undefined {
  if (value === null || value === undefined) return undefined;
  const { year, month, day } = plainDate(value).withCalendar("iso8601");
  const date = new Date(year, month - 1, day);
  date.setFullYear(year); // years 0–99
  return date;
}

/** PlainDate (or null) -> value for `<input type="date">`. */
export function toDateInput(value: PlainDateInput | null | undefined): string {
  if (value === null || value === undefined) return "";
  return plainDate(value).withCalendar("iso8601").toString({ calendarName: "never" });
}

/**
 * A wall-clock date and time with no timezone -> exact moment, read in `timeZone`
 * (default: the user's). Accepts:
 * - an `<input type="datetime-local">` value ("2026-11-07T14:30")
 * - a `CalendarDateTime` from HeroUI (NextUI) / React Aria date pickers
 *   (a `ZonedDateTime` already has its own timezone, which is used instead)
 *
 * Times that don't exist because of a daylight-saving jump (e.g. 02:30 when clocks skip to 03:00)
 * are moved forward, the same way browsers and calendars handle them.
 */
export function fromDateTimeInput(
  value: string | CalendarLibraryValue | null | undefined,
  timeZone: string = userTimeZone(),
): Temporal.Instant | null {
  if (value === null || value === undefined) return null;
  if (isCalendarLibraryValue(value)) {
    if (typeof value.timeZone === "string") return instant(value as unknown as InstantInput);
    value = value.toString();
  }
  if (typeof value !== "string") {
    throw new DateBridgeError("fromDateTimeInput() expects a datetime-local string or a CalendarDateTime.");
  }
  if (value.trim() === "") return null;
  checkTimeZone(timeZone);
  let local: Temporal.PlainDateTime;
  try {
    local = getTemporal().PlainDateTime.from(value.trim());
  } catch {
    throw new DateBridgeError(
      `Cannot read ${JSON.stringify(value)} as a datetime-local value. Expected "YYYY-MM-DDTHH:mm".`,
    );
  }
  return local.toZonedDateTime(timeZone, { disambiguation: "compatible" }).toInstant();
}

/** Exact moment (or null) -> value for `<input type="datetime-local">`, shown in `timeZone`. */
export function toDateTimeInput(
  value: InstantInput | null | undefined,
  timeZone: string = userTimeZone(),
  options: { seconds?: boolean } = {},
): string {
  if (value === null || value === undefined) return "";
  return zoned(instant(value), timeZone)
    .toPlainDateTime()
    .toString({ smallestUnit: options.seconds ? "second" : "minute" });
}
