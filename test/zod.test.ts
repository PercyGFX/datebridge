import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isInstant, isPlainDate } from "../src/index.js";
import { zInstant, zPlainDate } from "../src/zod.js";

const Bet = z.object({
  id: z.string(),
  placedAt: zInstant(),
  gameDay: zPlainDate(),
  settledAt: zInstant().nullable(),
});

describe("zod codecs", () => {
  const json = { id: "b1", placedAt: "2026-11-07T14:30:00Z", gameDay: "2026-11-07", settledAt: null };

  it("decode API strings into Temporal values", () => {
    const bet = Bet.parse(json);
    expect(isInstant(bet.placedAt)).toBe(true);
    expect(isPlainDate(bet.gameDay)).toBe(true);
    expect(bet.gameDay.toString()).toBe("2026-11-07");
  });

  it("encode back to the same JSON", () => {
    const bet = Bet.parse(json);
    expect(z.encode(Bet, bet)).toEqual(json);
    expect(JSON.parse(JSON.stringify(bet))).toEqual(json); // Temporal's toJSON gives the same strings
  });

  it("reject the strings behind day-shift bugs, with a useful message", () => {
    const shifted = Bet.safeParse({ ...json, gameDay: "2026-11-06T18:30:00.000Z" });
    expect(shifted.success).toBe(false);
    expect(shifted.error?.issues[0]?.path).toEqual(["gameDay"]);
    expect(shifted.error?.issues[0]?.message).toMatch(/timestamp, not a calendar date/);

    const noZone = Bet.safeParse({ ...json, placedAt: "2026-11-07T14:30" });
    expect(noZone.success).toBe(false);
    expect(noZone.error?.issues[0]?.message).toMatch(/no timezone/);
  });

  it("reject wrong types", () => {
    expect(Bet.safeParse({ ...json, placedAt: 123 }).success).toBe(false);
    expect(Bet.safeParse({ ...json, gameDay: "2026-02-30" }).success).toBe(false);
  });
});
