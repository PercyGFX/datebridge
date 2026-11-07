import { describe, expect, it } from "vitest";
import { object, string, ValidationError, type InferType } from "yup";
import { isInstant, isPlainDate } from "../src/index.js";
import { yupInstant, yupPlainDate } from "../src/yup.js";

const Bet = object({
  id: string().required(),
  placedAt: yupInstant().required(),
  gameDay: yupPlainDate().required(),
  settledAt: yupInstant().nullable(),
});

const json = { id: "b1", placedAt: "2026-11-07T14:30:00Z", gameDay: "2026-11-07", settledAt: null };

const errorOf = async (value: unknown, options = {}) => {
  try {
    await Bet.validate(value, options);
  } catch (error) {
    if (error instanceof ValidationError) return error;
    throw error;
  }
  return undefined;
};

describe("Yup schemas", () => {
  it("convert form/API strings into Temporal values, with types", async () => {
    const bet: InferType<typeof Bet> = await Bet.validate(json);
    const placedAt: Temporal.Instant = bet.placedAt; // inferred, not `any`
    expect(isInstant(placedAt)).toBe(true);
    expect(isPlainDate(bet.gameDay)).toBe(true);
    expect(bet.gameDay.toString()).toBe("2026-11-07");
    expect(bet.settledAt).toBeNull();
    expect(JSON.parse(JSON.stringify(bet))).toEqual(json);
  });

  it("cast() converts without validating", () => {
    expect(isInstant(Bet.cast(json).placedAt)).toBe(true);
  });

  it("reject the strings behind day-shift bugs, with a useful message", async () => {
    const shifted = await errorOf({ ...json, gameDay: "2026-11-06T18:30:00.000Z" });
    expect(shifted?.path).toBe("gameDay");
    expect(shifted?.message).toMatch(/^gameDay is invalid: .*timestamp, not a calendar date/);

    const noZone = await errorOf({ ...json, placedAt: "2026-11-07T14:30" });
    expect(noZone?.message).toMatch(/^placedAt is invalid: .*no timezone/);
  });

  it("never treats text from the input as a message template", async () => {
    const error = await errorOf({ ...json, gameDay: "${path} 12:00" });
    expect(error?.message).toContain('"${path} 12:00"');
  });

  it("reject wrong types and missing values", async () => {
    expect((await errorOf({ ...json, placedAt: 123 }))?.message).toBe(
      'placedAt must be an ISO 8601 date-time with "Z" or an offset',
    );
    expect((await errorOf({ ...json, gameDay: "2026-02-30" }))?.message).toMatch(/not a real calendar date/);
    expect((await errorOf({ ...json, gameDay: undefined }))?.message).toBe("gameDay is a required field");
  });

  it("explain strict mode, which skips conversion", async () => {
    expect((await errorOf(json, { strict: true }))?.message).toMatch(/strict mode/);
    const already = { ...json, placedAt: Temporal.Instant.from(json.placedAt), gameDay: Temporal.PlainDate.from(json.gameDay) };
    expect(await errorOf(already, { strict: true })).toBeUndefined();
  });
});
