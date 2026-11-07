import type { Temporal } from "temporal-spec";

export type { Temporal };

/** The `Temporal` namespace object (native, or a polyfill). */
export type TemporalAPI = typeof Temporal;

/** Thrown for every datebridge error, with a message that says how to fix it. */
export class DateBridgeError extends Error {
  override name = "DateBridgeError";
}

let configured: TemporalAPI | undefined;

/**
 * Use a specific Temporal implementation instead of `globalThis.Temporal`.
 * Only needed if you import a polyfill without installing it globally:
 *
 * ```ts
 * import { Temporal } from "temporal-polyfill";
 * configure({ Temporal });
 * ```
 */
export function configure(options: { Temporal?: TemporalAPI | undefined }): void {
  configured = options.Temporal;
}

/** @internal */
export function getTemporal(): TemporalAPI {
  const api = configured ?? (globalThis as { Temporal?: TemporalAPI }).Temporal;
  if (!api) {
    throw new DateBridgeError(
      'Temporal is not available here. Add `import "temporal-polyfill/global"` at the top of your app ' +
        "(needed for Safari and Node.js below 26), or call configure({ Temporal }).",
    );
  }
  return api;
}

const tag = (value: unknown): string => Object.prototype.toString.call(value);

// Tag checks instead of `instanceof`, so values from a different polyfill copy
// (or native vs polyfill) are still recognised.
export const isInstant = (value: unknown): value is Temporal.Instant =>
  tag(value) === "[object Temporal.Instant]";
export const isPlainDate = (value: unknown): value is Temporal.PlainDate =>
  tag(value) === "[object Temporal.PlainDate]";
export const isZonedDateTime = (value: unknown): value is Temporal.ZonedDateTime =>
  tag(value) === "[object Temporal.ZonedDateTime]";
export const isPlainDateTime = (value: unknown): value is Temporal.PlainDateTime =>
  tag(value) === "[object Temporal.PlainDateTime]";
export const isPlainTime = (value: unknown): value is Temporal.PlainTime =>
  tag(value) === "[object Temporal.PlainTime]";

/** @internal */
export const isDate = (value: unknown): value is Date => tag(value) === "[object Date]";

/** @internal Short description of a value for error messages. */
export function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || value === undefined) return String(value);
  if (isDate(value)) return `Date(${Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString()})`;
  const t = tag(value).slice(8, -1);
  return t === "Object" ? "an object" : t;
}
