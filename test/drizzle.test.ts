import { and, eq, gte, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dayRange, isInstant, isPlainDate } from "../src/index.js";
import { instantColumn, plainDateColumn } from "../src/drizzle.js";
import { startPostgres } from "./helpers/postgres.js";

const TZ = process.env.TZ ?? "(system)";

const bets = pgTable("bets", {
  id: serial("id").primaryKey(),
  player: text("player").notNull(),
  placedAt: instantColumn("placed_at").notNull().default(sql`now()`),
  settledAt: instantColumn("settled_at", { precision: 3 }),
  gameDay: plainDateColumn("game_day").notNull(),
});

describe("column SQL types", () => {
  it("map to timestamptz and date", () => {
    expect(bets.placedAt.getSQLType()).toBe("timestamp with time zone");
    expect(bets.settledAt.getSQLType()).toBe("timestamp(3) with time zone");
    expect(bets.gameDay.getSQLType()).toBe("date");
  });
});

describe(`Drizzle + node-postgres + real Postgres [TZ=${TZ}]`, () => {
  let server: Awaited<ReturnType<typeof startPostgres>>;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    server = await startPostgres(54392);
    pool = new pg.Pool({ connectionString: server.connectionString, max: 1 });
    db = drizzle(pool);
    await pool.query(`
      create table bets (
        id serial primary key,
        player text not null,
        placed_at timestamptz not null default now(),
        settled_at timestamptz(3),
        game_day date not null
      )`);
  });

  afterAll(async () => {
    await pool?.end();
    await server?.stop();
  });

  it("inserts and selects Temporal values", async () => {
    const placedAt = Temporal.Instant.from("2026-11-07T23:30:00.123456Z");
    const gameDay = Temporal.PlainDate.from("2026-11-07");
    const [row] = await db.insert(bets).values({ player: "ana", placedAt, gameDay }).returning();

    expect(isInstant(row!.placedAt)).toBe(true);
    expect(row!.placedAt.equals(placedAt)).toBe(true);
    expect(isPlainDate(row!.gameDay)).toBe(true);
    expect(row!.gameDay.toString()).toBe("2026-11-07");
    expect(row!.settledAt).toBeNull();
  });

  it("uses the database default for now()", async () => {
    const [row] = await db
      .insert(bets)
      .values({ player: "ben", gameDay: Temporal.PlainDate.from("2026-11-08") })
      .returning();
    expect(isInstant(row!.placedAt)).toBe(true);
  });

  it("filters by a calendar date and by a user's day with dayRange()", async () => {
    await db.insert(bets).values([
      { player: "cy", placedAt: Temporal.Instant.from("2026-11-07T18:00:00Z"), gameDay: Temporal.PlainDate.from("2026-11-07") },
      { player: "cy", placedAt: Temporal.Instant.from("2026-11-07T19:00:00Z"), gameDay: Temporal.PlainDate.from("2026-11-08") },
    ]);

    const byDay = await db
      .select()
      .from(bets)
      .where(and(eq(bets.player, "cy"), eq(bets.gameDay, Temporal.PlainDate.from("2026-11-07"))));
    expect(byDay.map((b) => b.placedAt.toString())).toEqual(["2026-11-07T18:00:00Z"]);

    // "Bets cy placed on Nov 8, Kolkata time" = 2026-11-07T18:30Z up to 2026-11-08T18:30Z.
    const { start, end } = dayRange("2026-11-08", "Asia/Kolkata");
    const kolkataDay = await db
      .select()
      .from(bets)
      .where(and(eq(bets.player, "cy"), gte(bets.placedAt, start), lt(bets.placedAt, end)));
    expect(kolkataDay.map((b) => b.placedAt.toString())).toEqual(["2026-11-07T19:00:00Z"]);
  });

  it("reads correctly whatever the session TimeZone is", async () => {
    await pool.query("set time zone 'Pacific/Kiritimati'");
    try {
      const rows = await db.select().from(bets).where(eq(bets.player, "ana"));
      expect(rows[0]!.placedAt.toString()).toBe("2026-11-07T23:30:00.123456Z");
      expect(rows[0]!.gameDay.toString()).toBe("2026-11-07");
    } finally {
      await pool.query("set time zone 'UTC'");
    }
  });

  it("explains infinity values instead of returning garbage", async () => {
    await pool.query(`insert into bets (player, placed_at, game_day) values ('inf', 'infinity', '2026-11-07')`);
    await expect(db.select().from(bets).where(eq(bets.player, "inf"))).rejects.toThrow(/infinity/);
  });
});
