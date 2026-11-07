// Helpers for <input type="date"> and <input type="datetime-local">.
// Their `.value` is a plain string; never use `.valueAsDate`, which is UTC midnight.

import { instant, plainDate, userTimeZone, zoned, checkTimeZone, type InstantInput, type PlainDateInput } from "./core.js";
import { DateBridgeError, getTemporal, type Temporal } from "./runtime.js";

/** `<input type="date">` value ("2026-11-07" or "") -> PlainDate or null. */
export function fromDateInput(value: string | null | undefined): Temporal.PlainDate | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  return plainDate(value);
}

/** PlainDate (or null) -> value for `<input type="date">`. */
export function toDateInput(value: PlainDateInput | null | undefined): string {
  if (value === null || value === undefined) return "";
  return plainDate(value).withCalendar("iso8601").toString({ calendarName: "never" });
}

/**
 * `<input type="datetime-local">` value ("2026-11-07T14:30") -> exact moment, read as wall-clock
 * time in `timeZone` (default: the user's).
 *
 * Times that don't exist because of a daylight-saving jump (e.g. 02:30 when clocks skip to 03:00)
 * are moved forward, the same way browsers and calendars handle them.
 */
export function fromDateTimeInput(
  value: string | null | undefined,
  timeZone: string = userTimeZone(),
): Temporal.Instant | null {
  if (value === null || value === undefined || value.trim() === "") return null;
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
