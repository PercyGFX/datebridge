import BaseJoi from "joi";
import { describe, expect, it } from "vitest";
import { isInstant, isPlainDate } from "../src/index.js";
import { extendJoi, joiTemporal } from "../src/joi.js";

const Joi = extendJoi(BaseJoi);

const Bet = Joi.object({
  id: Joi.string().required(),
  placedAt: Joi.instant().required(),
  gameDay: Joi.plainDate().required(),
  settledAt: Joi.instant().allow(null),
});

const json = { id: "b1", placedAt: "2026-11-07T14:30:00Z", gameDay: "2026-11-07", settledAt: null };

describe("Joi extension", () => {
  it("converts API strings into Temporal values", () => {
    const { value, error } = Bet.validate(json);
    expect(error).toBeUndefined();
    expect(isInstant(value.placedAt)).toBe(true);
    expect(isPlainDate(value.gameDay)).toBe(true);
    expect(value.gameDay.toString()).toBe("2026-11-07");
    expect(value.settledAt).toBeNull();
    expect(JSON.parse(JSON.stringify(value))).toEqual(json); // Temporal's toJSON gives the same strings back
  });

  it("rejects the strings behind day-shift bugs, with a useful message", () => {
    const shifted = Bet.validate({ ...json, gameDay: "2026-11-06T18:30:00.000Z" });
    expect(shifted.error?.details[0]?.path).toEqual(["gameDay"]);
    expect(shifted.error?.details[0]?.type).toBe("plainDate.invalid");
    expect(shifted.error?.message).toMatch(/^"gameDay" is invalid: .*timestamp, not a calendar date/);

    const noZone = Bet.validate({ ...json, placedAt: "2026-11-07T14:30" });
    expect(noZone.error?.message).toMatch(/^"placedAt" is invalid: .*no timezone/);
  });

  it("rejects wrong types and missing values", () => {
    expect(Bet.validate({ ...json, placedAt: 123 }).error?.message).toBe(
      '"placedAt" must be an ISO 8601 date-time with "Z" or an offset',
    );
    expect(Bet.validate({ ...json, gameDay: "2026-02-30" }).error?.details[0]?.type).toBe("plainDate.invalid");
    expect(Bet.validate({ ...json, gameDay: undefined }).error?.message).toBe('"gameDay" is required');
  });

  it("accepts values that are already Temporal, and honours convert: false", () => {
    const already = { ...json, placedAt: Temporal.Instant.from(json.placedAt), gameDay: Temporal.PlainDate.from(json.gameDay) };
    expect(Bet.validate(already, { convert: false }).error).toBeUndefined();
    expect(Bet.validate(json, { convert: false }).error?.details[0]?.type).toBe("instant.base");
  });

  it("also works with plain Joi.extend(...joiTemporal)", () => {
    const J = BaseJoi.extend(...joiTemporal);
    expect(isPlainDate(J.plainDate().validate("2026-11-07").value)).toBe(true);
  });
});
