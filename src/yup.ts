// Yup (v1) schemas for Temporal values.
//
//   const Bet = object({ placedAt: yupInstant().required(), gameDay: yupPlainDate().required() });
//   const bet = await Bet.validate(form); // bet.placedAt is a Temporal.Instant

import { mixed } from "yup";
import { instant, plainDate } from "./core.js";
import { isInstant, isPlainDate, type Temporal } from "./runtime.js";

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

// `T extends {}` matches Yup's own constraint on mixed<T> (any non-null value).
function temporalSchema<T extends {}>(
  name: string,
  is: (value: unknown) => value is T,
  parse: (value: string) => T,
  expected: string,
) {
  // No type guard on mixed(): a failed conversion should reach the test below, so the
  // error explains what's wrong instead of Yup's generic "must be a `mixed` type".
  return mixed<T>()
    .transform((value: unknown) => {
      if (typeof value !== "string") return value;
      try {
        return parse(value);
      } catch {
        return value; // left as a string; the test reports why
      }
    })
    .test(name, (value: unknown, ctx) => {
      if (value === null || value === undefined || is(value)) return true; // .required()/.nullable() decide
      if (typeof value !== "string") return ctx.createError({ message: `\${path} must be ${expected}` });
      try {
        parse(value);
        // Only reachable in strict mode, which skips transforms.
        return ctx.createError({ message: "${path} must be converted first (strict mode skips conversion)" });
      } catch (error) {
        // Passed as a param so text from the input is never treated as a ${...} template.
        return ctx.createError({ message: "${path} is invalid: ${reason}", params: { reason: reason(error) } });
      }
    });
}

/**
 * An ISO 8601 string with "Z" or an offset -> `Temporal.Instant`.
 * Rejects strings without a timezone, like "2026-11-07T14:30".
 */
export function yupInstant() {
  return temporalSchema<Temporal.Instant>("instant", isInstant, instant, 'an ISO 8601 date-time with "Z" or an offset');
}

/**
 * A "YYYY-MM-DD" string -> `Temporal.PlainDate`.
 * Rejects timestamps like "2026-11-06T18:30:00Z", which is how most day-shift bugs arrive.
 */
export function yupPlainDate() {
  return temporalSchema<Temporal.PlainDate>("plainDate", isPlainDate, plainDate, 'a calendar date in "YYYY-MM-DD" format');
}
