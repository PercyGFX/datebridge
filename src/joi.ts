// Joi (v17+) types for Temporal values. Joi itself is never imported at runtime:
// the extensions use the Joi instance you pass to `extendJoi()` / `Joi.extend()`.
//
//   const Joi = extendJoi(BaseJoi);
//   const Bet = Joi.object({ placedAt: Joi.instant().required(), gameDay: Joi.plainDate().required() });
//   const { value, error } = Bet.validate(req.body); // value.placedAt is a Temporal.Instant

import type { AnySchema, ExtensionFactory, Root } from "joi";
import { instant, plainDate } from "./core.js";
import { isInstant, isPlainDate, type Temporal } from "./runtime.js";

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

function temporalType(
  type: "instant" | "plainDate",
  is: (value: unknown) => boolean,
  parse: (value: string) => unknown,
  expected: string,
): ExtensionFactory {
  return (joi) => ({
    type,
    base: joi.any(),
    messages: {
      [`${type}.base`]: `{{#label}} must be ${expected}`,
      [`${type}.invalid`]: "{{#label}} is invalid: {#reason}",
    },
    validate(value, helpers) {
      if (is(value)) return { value };
      // Like Joi.date(): with `convert: false`, only an already-converted value passes.
      if (typeof value !== "string" || helpers.prefs.convert === false) {
        return { value, errors: helpers.error(`${type}.base`) };
      }
      try {
        return { value: parse(value) };
      } catch (error) {
        return { value, errors: helpers.error(`${type}.invalid`, { reason: reason(error) }) };
      }
    },
  });
}

/**
 * The Joi extensions, for `Joi.extend(...joiTemporal)`. In TypeScript, prefer
 * {@link extendJoi}, which also gives you types for the new methods.
 */
export const joiTemporal: ExtensionFactory[] = [
  temporalType("instant", isInstant, instant, 'an ISO 8601 date-time with "Z" or an offset'),
  temporalType("plainDate", isPlainDate, plainDate, 'a calendar date in "YYYY-MM-DD" format'),
];

/** A Joi root with `instant()` and `plainDate()` added. */
export interface TemporalJoiRoot extends Root {
  /**
   * An ISO 8601 string with "Z" or an offset -> `Temporal.Instant`.
   * Rejects strings without a timezone, like "2026-11-07T14:30".
   */
  instant(): AnySchema<Temporal.Instant>;
  /**
   * A "YYYY-MM-DD" string -> `Temporal.PlainDate`.
   * Rejects timestamps like "2026-11-06T18:30:00Z", which is how most day-shift bugs arrive.
   */
  plainDate(): AnySchema<Temporal.PlainDate>;
}

/**
 * Returns a copy of Joi with `Joi.instant()` and `Joi.plainDate()`.
 *
 * ```ts
 * import BaseJoi from "joi";
 * import { extendJoi } from "datebridge/joi";
 * const Joi = extendJoi(BaseJoi);
 * ```
 */
export function extendJoi(joi: Root): TemporalJoiRoot {
  return joi.extend(...joiTemporal) as TemporalJoiRoot;
}
