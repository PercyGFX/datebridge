// node-postgres (`pg`) support. This file never imports `pg` itself: you pass in `pg.types`.

import {
  formatPg,
  parsePgArray,
  parsePgDate,
  parsePgTime,
  parsePgTimestamp,
  parsePgTimestamptz,
  type PgInfinity,
} from "./internal/postgres.js";
import { isInstant, isPlainDate, isPlainDateTime, isPlainTime, isZonedDateTime, type Temporal } from "./runtime.js";

export type { PgInfinity };

/** Postgres type OIDs that datebridge handles. */
export const PG_TYPES = {
  date: 1082,
  time: 1083,
  timestamp: 1114,
  timestamptz: 1184,
  dateArray: 1182,
  timeArray: 1183,
  timestampArray: 1115,
  timestamptzArray: 1185,
} as const;

export interface TemporalTypeOptions {
  /**
   * How to read `timestamp` columns (without time zone), which store a wall-clock time
   * with no zone.
   * - `"plainDateTime"` (default): Temporal.PlainDateTime, which is what the column really holds.
   * - `"utc"`: Temporal.Instant, treating the value as UTC. Use this for older schemas
   *   that store UTC in `timestamp` columns.
   */
  timestamp?: "plainDateTime" | "utc";
}

type TextParser = (value: string) => unknown;

/** Value parsers for each Postgres type, for use with any driver that gives you text. */
export const parse = {
  date: parsePgDate,
  timestamptz: parsePgTimestamptz,
  timestamp: parsePgTimestamp,
  time: parsePgTime,
};

function parsersFor(options: TemporalTypeOptions): Map<number, TextParser> {
  const timestamp: TextParser =
    options.timestamp === "utc"
      ? (text) => {
          if (text === "infinity" || text === "-infinity") return text;
          return parsePgTimestamptz(text.endsWith(" BC") ? `${text.slice(0, -3)}+00 BC` : `${text}+00`);
        }
      : parsePgTimestamp;
  return new Map<number, TextParser>([
    [PG_TYPES.date, parsePgDate],
    [PG_TYPES.time, parsePgTime],
    [PG_TYPES.timestamp, timestamp],
    [PG_TYPES.timestamptz, parsePgTimestamptz],
    [PG_TYPES.dateArray, (text) => parsePgArray(text, parsePgDate)],
    [PG_TYPES.timeArray, (text) => parsePgArray(text, parsePgTime)],
    [PG_TYPES.timestampArray, (text) => parsePgArray(text, timestamp)],
    [PG_TYPES.timestamptzArray, (text) => parsePgArray(text, parsePgTimestamptz)],
  ]);
}

/** Anything with pg's `types.setTypeParser`, such as `import pg from "pg"; pg.types`. */
export interface PgTypeRegistry {
  setTypeParser(oid: number, parseFn: (value: string) => any): void;
}

/** Anything with pg's `types.getTypeParser`. */
export interface PgTypeSource {
  getTypeParser(oid: number, format?: any): any;
}

/**
 * Makes every query return Temporal values instead of `Date`s, for all connections:
 *
 * | Postgres      | You get                    |
 * |---------------|----------------------------|
 * | `date`        | Temporal.PlainDate         |
 * | `timestamptz` | Temporal.Instant           |
 * | `timestamp`   | Temporal.PlainDateTime     |
 * | `time`        | Temporal.PlainTime         |
 *
 * Arrays of these work too. `'infinity'` and `'-infinity'` come back as those strings.
 *
 * ```ts
 * import pg from "pg";
 * import { useTemporalTypes } from "datebridge/pg";
 * useTemporalTypes(pg.types);
 * ```
 */
export function useTemporalTypes(types: PgTypeRegistry, options: TemporalTypeOptions = {}): void {
  for (const [oid, parser] of parsersFor(options)) types.setTypeParser(oid, parser);
}

/**
 * Same as {@link useTemporalTypes}, but only for one pool, client or query:
 *
 * ```ts
 * const pool = new pg.Pool({ types: createTemporalTypes(pg.types) });
 * ```
 */
export function createTemporalTypes(base: PgTypeSource, options: TemporalTypeOptions = {}): PgTypeSource {
  const parsers = parsersFor(options);
  return {
    getTypeParser(oid: number, format?: any) {
      if (format === undefined || format === "text") {
        const parser = parsers.get(oid);
        if (parser) return parser;
      }
      return base.getTypeParser(oid, format);
    },
  };
}

/**
 * Converts query parameters so Postgres can read them. Temporal values become text that
 * Postgres understands; arrays and everything else pass through.
 *
 * Without this, pg sends Temporal values as JSON (with quotes) and Postgres rejects them.
 *
 * ```ts
 * await pool.query("insert into bets (placed_at, game_day) values ($1, $2)", toPg([now(), today("Europe/London")]));
 * ```
 */
export function toPg(values: readonly unknown[]): unknown[];
export function toPg(value: unknown): unknown;
export function toPg(value: unknown): unknown {
  return convert(value);
}

function convert(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(convert);
  if (isInstant(value) || isPlainDate(value) || isPlainDateTime(value) || isPlainTime(value)) return formatPg(value);
  if (isZonedDateTime(value)) return formatPg(value.toInstant());
  return value;
}

/** Temporal value -> Postgres text. Exposed for custom drivers. */
export function formatForPostgres(
  value: Temporal.Instant | Temporal.ZonedDateTime | Temporal.PlainDate | Temporal.PlainDateTime | Temporal.PlainTime,
): string {
  return formatPg(isZonedDateTime(value) ? value.toInstant() : value);
}
