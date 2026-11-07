// Zod 4 codecs: validate dates in API payloads and turn them into Temporal values.
//
//   const Bet = z.object({ placedAt: zInstant(), gameDay: zPlainDate() });
//   Bet.parse(json)          // strings -> Temporal (decode)
//   z.encode(Bet, bet)       // Temporal -> strings, ready for JSON

import { z } from "zod";
import { instant, plainDate } from "./core.js";
import { isInstant, isPlainDate, type Temporal } from "./runtime.js";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * An ISO 8601 string with "Z" or an offset <-> `Temporal.Instant`.
 * Rejects strings without a timezone, like "2026-11-07T14:30".
 */
export function zInstant() {
  return z.codec(z.string(), z.custom<Temporal.Instant>(isInstant, { message: "Expected a Temporal.Instant" }), {
    decode(value, ctx) {
      try {
        return instant(value);
      } catch (error) {
        ctx.issues.push({ code: "custom", message: message(error), input: value });
        return z.NEVER;
      }
    },
    encode: (value) => value.toString(),
  });
}

/**
 * A "YYYY-MM-DD" string <-> `Temporal.PlainDate`.
 * Rejects timestamps like "2026-11-06T18:30:00Z", which is how most day-shift bugs arrive.
 * Exact UTC midnight ("2026-11-07T00:00:00.000Z") is accepted, so older clients keep working.
 */
export function zPlainDate() {
  return z.codec(z.string(), z.custom<Temporal.PlainDate>(isPlainDate, { message: "Expected a Temporal.PlainDate" }), {
    decode(value, ctx) {
      try {
        return plainDate(value);
      } catch (error) {
        ctx.issues.push({ code: "custom", message: message(error), input: value });
        return z.NEVER;
      }
    },
    encode: (value) => value.withCalendar("iso8601").toString(),
  });
}
