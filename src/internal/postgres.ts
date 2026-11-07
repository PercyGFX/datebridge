// Parsing and formatting of Postgres text values (DateStyle ISO, the default).
//
//   date         2026-11-07 | 10000-01-01 | 0044-03-15 BC | infinity | -infinity
//   timestamp    2026-11-07 14:30:00 | 2026-11-07 14:30:00.123456 | ... BC
//   timestamptz  2026-11-07 14:30:00+00 | ...+05:30 | ...+05:53:28 | ...+00 BC
//   time         14:30:00 | 14:30:00.123456

import { DateBridgeError, getTemporal, type Temporal } from "../runtime.js";

export type PgInfinity = "infinity" | "-infinity";

const DATE = /^(\d{4,})-(\d{2})-(\d{2})( BC)?$/;
const DATE_TIME =
  /^(\d{4,})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)(Z|[+-]\d{2}(?::?\d{2}(?::?\d{2})?)?)?( BC)?$/;

const isInfinity = (text: string): text is PgInfinity => text === "infinity" || text === "-infinity";

/** Postgres year text (+ BC flag) -> Temporal ISO year text ("2026", "+010000", "-000043"). */
function isoYear(yearText: string, bc: boolean): string {
  const year = bc ? 1 - Number(yearText) : Number(yearText);
  if (year >= 0 && year <= 9999) return String(year).padStart(4, "0");
  return (year < 0 ? "-" : "+") + String(Math.abs(year)).padStart(6, "0");
}

/** "+05" -> "+05:00", "+0530" -> "+05:30", "Z" -> "Z". */
function isoOffset(offset: string): string {
  if (offset === "Z") return offset;
  const m = /^([+-])(\d{2}):?(\d{2})?:?(\d{2})?$/.exec(offset);
  if (!m) return offset;
  return `${m[1]}${m[2]}:${m[3] ?? "00"}${m[4] ? `:${m[4]}` : ""}`;
}

function bad(kind: string, text: string): never {
  throw new DateBridgeError(
    `Cannot read Postgres ${kind} value ${JSON.stringify(text)}. ` +
      "datebridge expects the default DateStyle (ISO); check `SHOW DateStyle`.",
  );
}

export function parsePgDate(text: string): Temporal.PlainDate | PgInfinity {
  if (isInfinity(text)) return text;
  const m = DATE.exec(text);
  if (!m) bad("date", text);
  return getTemporal().PlainDate.from(`${isoYear(m[1]!, !!m[4])}-${m[2]}-${m[3]}`);
}

export function parsePgTimestamptz(text: string): Temporal.Instant | PgInfinity {
  if (isInfinity(text)) return text;
  const m = DATE_TIME.exec(text);
  if (!m || !m[5]) bad("timestamptz", text);
  return getTemporal().Instant.from(`${isoYear(m[1]!, !!m[6])}-${m[2]}-${m[3]}T${m[4]}${isoOffset(m[5])}`);
}

export function parsePgTimestamp(text: string): Temporal.PlainDateTime | PgInfinity {
  if (isInfinity(text)) return text;
  const m = DATE_TIME.exec(text);
  if (!m || m[5]) bad("timestamp", text);
  return getTemporal().PlainDateTime.from(`${isoYear(m[1]!, !!m[6])}-${m[2]}-${m[3]}T${m[4]}`);
}

export function parsePgTime(text: string): Temporal.PlainTime {
  if (!/^\d{2}:\d{2}:\d{2}(\.\d{1,9})?$/.test(text)) bad("time", text);
  return getTemporal().PlainTime.from(text);
}

/** Parses a Postgres array literal like `{2026-11-07,NULL}` or `{"2026-11-07 14:30:00+00"}`. */
export function parsePgArray<T>(text: string, parseItem: (item: string) => T): unknown[] {
  let i = 0;
  const parseList = (): unknown[] => {
    if (text[i] !== "{") bad("array", text);
    i++;
    const out: unknown[] = [];
    if (text[i] === "}") {
      i++;
      return out;
    }
    for (;;) {
      if (text[i] === "{") {
        out.push(parseList());
      } else if (text[i] === '"') {
        let end = i + 1;
        let raw = "";
        while (end < text.length && text[end] !== '"') {
          if (text[end] === "\\") end++;
          raw += text[end];
          end++;
        }
        i = end + 1;
        out.push(parseItem(raw));
      } else {
        let end = i;
        while (end < text.length && text[end] !== "," && text[end] !== "}") end++;
        const raw = text.slice(i, end);
        i = end;
        out.push(raw === "NULL" ? null : parseItem(raw));
      }
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") {
        i++;
        return out;
      }
      bad("array", text);
    }
  };
  // Arrays with custom bounds look like "[0:1]={...}"; the bounds don't matter here.
  const eq = text.startsWith("[") ? text.indexOf("=") : -1;
  if (eq !== -1) i = eq + 1;
  return parseList();
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Year -> Postgres year text and BC suffix (year 0 = 1 BC). */
function pgYear(year: number): { y: string; bc: string } {
  return year >= 1 ? { y: pad(year, 4), bc: "" } : { y: pad(1 - year, 4), bc: " BC" };
}

const fraction = (ms: number, us: number, ns: number) => {
  const digits = `${pad(ms, 3)}${pad(us, 3)}${pad(ns, 3)}`.replace(/0+$/, "");
  return digits ? `.${digits}` : "";
};

/** Temporal value -> text Postgres accepts. Only handles the 4 Temporal kinds Postgres stores. */
export function formatPg(value: Temporal.PlainDate | Temporal.Instant | Temporal.PlainDateTime | Temporal.PlainTime): string {
  if ("epochNanoseconds" in value) {
    // Instant: write as UTC so the session TimeZone can't change its meaning.
    const z = value.toZonedDateTimeISO("UTC");
    if (z.year >= 1 && z.year <= 9999) return value.toString();
    const { y, bc } = pgYear(z.year);
    return `${y}-${pad(z.month)}-${pad(z.day)} ${pad(z.hour)}:${pad(z.minute)}:${pad(z.second)}${fraction(z.millisecond, z.microsecond, z.nanosecond)}+00${bc}`;
  }
  if (!("year" in value)) return value.toString(); // PlainTime
  if (value.calendarId !== "iso8601") value = value.withCalendar("iso8601");
  if (value.year >= 1 && value.year <= 9999) return value.toString();
  const { y, bc } = pgYear(value.year);
  const date = `${y}-${pad(value.month)}-${pad(value.day)}`;
  if (!("hour" in value)) return date + bc; // PlainDate
  return `${date} ${pad(value.hour)}:${pad(value.minute)}:${pad(value.second)}${fraction(value.millisecond, value.microsecond, value.nanosecond)}${bc}`;
}
