// Drizzle ORM column types for Postgres (drizzle-orm/pg-core).

import { customType } from "drizzle-orm/pg-core";
import { instant, plainDate } from "./core.js";
import { formatPg, parsePgDate, parsePgTimestamptz } from "./internal/postgres.js";
import { DateBridgeError, type Temporal } from "./runtime.js";

function noInfinity(kind: string, value: string): never {
  throw new DateBridgeError(
    `Postgres returned '${value}' for a ${kind} column. Temporal has no infinity value; ` +
      "use NULL instead, or a plain drizzle column if you need infinity.",
  );
}

/**
 * A `timestamptz` column that reads and writes `Temporal.Instant`.
 * Use it for exact moments: created at, bet placed at, expires at.
 *
 * ```ts
 * import { instantColumn } from "datebridge/drizzle";
 * export const bets = pgTable("bets", {
 *   placedAt: instantColumn("placed_at").notNull().default(sql`now()`),
 * });
 * ```
 */
export const instantColumn = customType<{
  data: Temporal.Instant;
  driverData: string;
  config: { precision?: 0 | 1 | 2 | 3 | 4 | 5 | 6 };
}>({
  dataType(config) {
    return config?.precision === undefined ? "timestamp with time zone" : `timestamp(${config.precision}) with time zone`;
  },
  toDriver(value) {
    return formatPg(instant(value));
  },
  fromDriver(value: unknown) {
    if (typeof value === "string") {
      const parsed = parsePgTimestamptz(value);
      return typeof parsed === "string" ? noInfinity("timestamptz", parsed) : parsed;
    }
    return instant(value as Date); // drivers that already parsed it (Date or Temporal)
  },
});

/**
 * A `date` column that reads and writes `Temporal.PlainDate`.
 * Use it for calendar days: birthdays, "promo ends Nov 30", game day. It never shifts by a day.
 *
 * ```ts
 * import { plainDateColumn } from "datebridge/drizzle";
 * export const promos = pgTable("promos", {
 *   endsOn: plainDateColumn("ends_on").notNull(),
 * });
 * ```
 */
export const plainDateColumn = customType<{ data: Temporal.PlainDate; driverData: string }>({
  dataType() {
    return "date";
  },
  toDriver(value) {
    return formatPg(plainDate(value));
  },
  fromDriver(value: unknown) {
    if (typeof value === "string") {
      const parsed = parsePgDate(value);
      return typeof parsed === "string" ? noInfinity("date", parsed) : parsed;
    }
    return plainDate(value as Date); // drivers that already parsed it into a midnight Date
  },
});
