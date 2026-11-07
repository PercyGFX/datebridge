// Values that date-picker components hand you: Date (react-datepicker, react-day-picker / shadcn),
// Dayjs (MUI with AdapterDayjs, Ant Design), Moment, and Luxon (MUI with AdapterLuxon).
import {
  BuddhistCalendar,
  JapaneseCalendar,
  parseDate,
  parseDateTime,
  parseZonedDateTime,
  toCalendar,
} from "@internationalized/date";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { DateTime } from "luxon";
import moment from "moment";
import { describe, expect, it } from "vitest";
import { object } from "yup";
import { formatInstant, fromDateTimeInput, instant, isInstant, plainDate, toPickerDate } from "../src/index.js";
import { yupInstant, yupPlainDate } from "../src/yup.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.TZ ?? "(system)";
const iso = "2026-11-07T14:30:00Z";

describe(`date + time pickers -> instant() [TZ=${TZ}]`, () => {
  it("reads Dayjs, Moment and Luxon values as the exact moment", () => {
    expect(instant(dayjs(iso)).toString()).toBe(iso);
    expect(instant(moment(iso)).toString()).toBe(iso);
    expect(instant(DateTime.fromISO(iso)).toString()).toBe(iso);
  });

  it("respects a picker set to a specific timezone", () => {
    // MUI <DateTimePicker timezone="Asia/Kolkata" />: the user picked 8:00 PM Kolkata time.
    expect(instant(dayjs.tz("2026-11-07 20:00", "Asia/Kolkata")).toString()).toBe(iso);
    expect(instant(DateTime.fromISO("2026-11-07T20:00", { zone: "Asia/Kolkata" })).toString()).toBe(iso);
  });

  it("works anywhere an exact moment is accepted", () => {
    expect(formatInstant(dayjs(iso), { locale: "en-GB", timeZone: "UTC", timeStyle: "short" })).toBe("14:30");
  });
});

describe(`date-only pickers -> plainDate() [TZ=${TZ}]`, () => {
  it("reads the day the picker shows, in every timezone", () => {
    expect(plainDate(dayjs("2026-11-07")).toString()).toBe("2026-11-07"); // AntD / MUI (local midnight)
    expect(plainDate(moment("2026-11-07")).toString()).toBe("2026-11-07");
    expect(plainDate(DateTime.fromISO("2026-11-07")).toString()).toBe("2026-11-07");
    expect(plainDate(new Date(2026, 10, 7)).toString()).toBe("2026-11-07"); // react-datepicker, shadcn
  });

  it("uses the picker's own timezone, not the device's", () => {
    expect(plainDate(dayjs.utc("2026-11-07")).toString()).toBe("2026-11-07");
    expect(plainDate(dayjs.tz("2026-11-07", "Pacific/Kiritimati")).toString()).toBe("2026-11-07");
    expect(plainDate(DateTime.fromISO("2026-11-07", { zone: "Pacific/Pago_Pago" })).toString()).toBe("2026-11-07");
  });

  it("toPickerDate() sets a Date-based picker to the saved day, in every timezone", () => {
    const value = toPickerDate("2026-11-07");
    expect([value.getFullYear(), value.getMonth() + 1, value.getDate(), value.getHours()]).toEqual([2026, 11, 7, 0]);
    expect(plainDate(value).toString()).toBe("2026-11-07"); // round-trips
    expect(toPickerDate(null)).toBeUndefined();
    expect(toPickerDate({ year: 50, month: 1, day: 2 }).getFullYear()).toBe(50);
  });

  it("gives clear errors for invalid values", () => {
    expect(() => plainDate(dayjs("nope"))).toThrow(/invalid date/);
    expect(() => plainDate(DateTime.invalid("bad input"))).toThrow(/invalid date/);
    expect(() => instant(dayjs("nope"))).toThrow(/Invalid Date/);
  });
});

describe(`HeroUI (NextUI) / React Aria pickers: @internationalized/date [TZ=${TZ}]`, () => {
  it("DatePicker -> CalendarDate -> plainDate()", () => {
    expect(plainDate(parseDate("2026-11-07")).toString()).toBe("2026-11-07");
  });

  it("reads non-Gregorian calendars correctly (Thai and Japanese locales)", () => {
    const buddhist = toCalendar(parseDate("2026-11-07"), new BuddhistCalendar());
    expect(buddhist.year).toBe(2569); // the naive { year, month, day } reading would be wrong
    expect(plainDate(buddhist).toString()).toBe("2026-11-07");
    const japanese = toCalendar(parseZonedDateTime("2026-11-07T20:00[Asia/Kolkata]"), new JapaneseCalendar());
    expect(instant(japanese).toString()).toBe(iso);
  });

  it("DatePicker with a ZonedDateTime -> instant()", () => {
    const value = parseZonedDateTime("2026-11-07T20:00[Asia/Kolkata]");
    expect(instant(value).toString()).toBe(iso);
    expect(fromDateTimeInput(value, "UTC")?.toString()).toBe(iso); // its own timezone wins
    expect(plainDate(value).toString()).toBe("2026-11-07");
  });

  it("DatePicker with a CalendarDateTime (no timezone) -> fromDateTimeInput()", () => {
    const value = parseDateTime("2026-11-07T20:00");
    expect(fromDateTimeInput(value, "Asia/Kolkata")?.toString()).toBe(iso);
    expect(plainDate(value).toString()).toBe("2026-11-07");
    expect(() => instant(value as never)).toThrow(/no timezone.*fromDateTimeInput/);
    expect(() => instant(parseDate("2026-11-07") as never)).toThrow(/calendar date.*plainDate/);
  });
});

describe(`Yup forms with picker values [TZ=${TZ}]`, () => {
  const DrawForm = object({ drawAt: yupInstant().required(), drawDay: yupPlainDate().required() });

  it("accepts Date and Dayjs values straight from the pickers", async () => {
    const form = await DrawForm.validate({ drawAt: dayjs(iso), drawDay: new Date(2026, 10, 7) });
    expect(isInstant(form.drawAt) && form.drawAt.toString()).toBe(iso);
    expect(form.drawDay.toString()).toBe("2026-11-07");
  });

  it("explains a Date with a time of day in a date-only field", async () => {
    await expect(
      DrawForm.validate({ drawAt: dayjs(iso), drawDay: new Date(Date.UTC(2026, 10, 7, 15, 45, 30)) }),
    ).rejects.toThrow(/drawDay is invalid: .*time of day/);
  });

  it("still rejects numbers", async () => {
    await expect(DrawForm.validate({ drawAt: 1, drawDay: "2026-11-07" })).rejects.toThrow(/drawAt must be/);
  });
});
