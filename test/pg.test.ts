import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isInstant, isPlainDate, isPlainDateTime, isPlainTime, plainDate } from "../src/index.js";
import { createTemporalTypes, formatForPostgres, parse, PG_TYPES, toPg, useTemporalTypes } from "../src/pg.js";
import { startPostgres } from "./helpers/postgres.js";

const TZ = process.env.TZ ?? "(system)";

describe("Postgres text parsing", () => {
  it("reads date values", () => {
    expect(String(parse.date("2026-11-07"))).toBe("2026-11-07");
    expect(String(parse.date("0044-03-15 BC"))).toBe("-000043-03-15");
    expect(String(parse.date("10000-01-01"))).toBe("+010000-01-01");
    expect(parse.date("infinity")).toBe("infinity");
    expect(parse.date("-infinity")).toBe("-infinity");
  });

  it("reads timestamptz values in any session timezone", () => {
    expect(String(parse.timestamptz("2026-11-07 14:30:00+00"))).toBe("2026-11-07T14:30:00Z");
    expect(String(parse.timestamptz("2026-11-07 20:00:00+05:30"))).toBe("2026-11-07T14:30:00Z");
    expect(String(parse.timestamptz("2026-11-07 09:30:00.123456-05"))).toBe("2026-11-07T14:30:00.123456Z");
    // Historical local mean time offsets have seconds.
    expect(String(parse.timestamptz("1900-01-01 00:00:00+05:53:28"))).toBe("1899-12-31T18:06:32Z");
    expect(String(parse.timestamptz("0044-03-15 12:00:00+00 BC"))).toBe("-000043-03-15T12:00:00Z");
  });

  it("reads timestamp and time values", () => {
    expect(String(parse.timestamp("2026-11-07 14:30:00.5"))).toBe("2026-11-07T14:30:00.5");
    expect(String(parse.time("14:30:00.123456"))).toBe("14:30:00.123456");
  });

  it("refuses non-ISO DateStyle output with a hint", () => {
    expect(() => parse.date("11/07/2026")).toThrow(/DateStyle/);
    expect(() => parse.timestamptz("2026-11-07 14:30:00")).toThrow(/timestamptz/);
  });

  it("writes values Postgres accepts, including BC and 5-digit years", () => {
    expect(formatForPostgres(Temporal.PlainDate.from("2026-11-07"))).toBe("2026-11-07");
    expect(formatForPostgres(Temporal.PlainDate.from({ year: -43, month: 3, day: 15 }))).toBe("0044-03-15 BC");
    expect(formatForPostgres(Temporal.PlainDate.from({ year: 10000, month: 1, day: 1 }))).toBe("10000-01-01");
    expect(formatForPostgres(Temporal.Instant.from("2026-11-07T14:30:00.123456Z"))).toBe("2026-11-07T14:30:00.123456Z");
    expect(formatForPostgres(Temporal.ZonedDateTime.from("2026-11-07T20:00:00+05:30[Asia/Kolkata]"))).toBe(
      "2026-11-07T14:30:00Z",
    );
  });

  it("toPg converts Temporal params and leaves everything else alone", () => {
    const date = Temporal.PlainDate.from("2026-11-07");
    const legacy = new Date();
    expect(toPg([date, 42, "x", null, legacy, [date]])).toEqual(["2026-11-07", 42, "x", null, legacy, ["2026-11-07"]]);
  });
});

describe("pg type registration", () => {
  it("registers parsers for every supported type", () => {
    const seen = new Map<number, (value: string) => unknown>();
    useTemporalTypes({ setTypeParser: (oid, fn) => seen.set(oid, fn) });
    expect([...seen.keys()].sort()).toEqual(Object.values(PG_TYPES).sort());
  });

  it("createTemporalTypes passes other types through to pg's defaults", () => {
    const types = createTemporalTypes(pg.types);
    expect(types.getTypeParser(20, "text")).toBe(pg.types.getTypeParser(20, "text")); // int8
    expect(types.getTypeParser(PG_TYPES.date, "binary")).toBe(pg.types.getTypeParser(PG_TYPES.date, "binary"));
  });
});

describe(`real Postgres via pg [TZ=${TZ}]`, () => {
  let server: Awaited<ReturnType<typeof startPostgres>>;
  let pool: pg.Pool;
  let plainPool: pg.Pool;

  beforeAll(async () => {
    server = await startPostgres(54391);
    pool = new pg.Pool({ connectionString: server.connectionString, max: 1, types: createTemporalTypes(pg.types) });
    plainPool = new pg.Pool({ connectionString: server.connectionString, max: 1 });
    await pool.query(`
      create table if not exists events (
        id serial primary key,
        game_day date,
        placed_at timestamptz,
        local_at timestamp,
        opens_at time,
        days date[],
        moments timestamptz[]
      )`);
  });

  afterAll(async () => {
    await pool?.end();
    await plainPool?.end();
    await server?.stop();
  });

  it("round-trips every type as Temporal values", async () => {
    const gameDay = Temporal.PlainDate.from("2026-11-07");
    const placedAt = Temporal.Instant.from("2026-11-07T14:30:00.123456Z");
    const localAt = Temporal.PlainDateTime.from("2026-11-07T14:30:00");
    const opensAt = Temporal.PlainTime.from("09:00");
    const days = [gameDay, Temporal.PlainDate.from({ year: -43, month: 3, day: 15 })];
    const moments = [placedAt, null];

    const { rows } = await pool.query(
      `insert into events (game_day, placed_at, local_at, opens_at, days, moments)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      toPg([gameDay, placedAt, localAt, opensAt, days, moments]),
    );
    const row = rows[0];
    expect(isPlainDate(row.game_day) && row.game_day.equals(gameDay)).toBe(true);
    expect(isInstant(row.placed_at) && row.placed_at.equals(placedAt)).toBe(true); // microseconds kept
    expect(isPlainDateTime(row.local_at) && row.local_at.equals(localAt)).toBe(true);
    expect(isPlainTime(row.opens_at) && row.opens_at.equals(opensAt)).toBe(true);
    expect(row.days.map(String)).toEqual(["2026-11-07", "-000043-03-15"]);
    expect(row.moments.map((m: unknown) => (m === null ? null : String(m)))).toEqual([placedAt.toString(), null]);
  });

  it("gives the same instant whatever the session TimeZone is", async () => {
    const client = await pool.connect();
    try {
      await client.query("set time zone 'Asia/Kolkata'");
      const { rows } = await client.query(
        "select '2026-11-07 14:30:00+00'::timestamptz as t, '2026-11-07 14:30:00+00'::timestamptz::text as raw",
      );
      expect(rows[0].raw).toBe("2026-11-07 20:00:00+05:30");
      expect(rows[0].t.toString()).toBe("2026-11-07T14:30:00Z");
    } finally {
      await client.query("set time zone 'UTC'");
      client.release();
    }
  });

  it("returns infinity as a string", async () => {
    const { rows } = await pool.query("select 'infinity'::timestamptz as a, '-infinity'::date as b");
    expect(rows[0]).toEqual({ a: "infinity", b: "-infinity" });
  });

  it("without datebridge, a date column turns into local midnight and can shift a day", async () => {
    const { rows } = await plainPool.query("select '2026-11-07'::date as d");
    const d: Date = rows[0].d;
    const offsetAhead = -d.getTimezoneOffset() > 0;
    // The classic bug: JSON.stringify / toISOString() moves it to the day before.
    expect(d.toISOString().slice(0, 10)).toBe(offsetAhead ? "2026-11-06" : "2026-11-07");
    // plainDate() reads the driver's local-midnight Date correctly.
    expect(plainDate(d).toString()).toBe("2026-11-07");
  });

  it("useTemporalTypes(pg.types) works globally", async () => {
    // @types/pg only lists scalar type ids, not array ones, so widen it for the restore step.
    const types = pg.types as unknown as {
      getTypeParser(oid: number, format: "text"): (value: string) => unknown;
      setTypeParser(oid: number, parseFn: (value: string) => unknown): void;
    };
    const oids = Object.values(PG_TYPES);
    const originals = oids.map((oid) => types.getTypeParser(oid, "text"));
    useTemporalTypes(pg.types);
    try {
      const { rows } = await plainPool.query("select '2026-11-07'::date as d");
      expect(isPlainDate(rows[0].d)).toBe(true);
    } finally {
      oids.forEach((oid, i) => types.setTypeParser(oid, originals[i]!));
    }
  });

  it("can read timestamp columns as UTC instants for older schemas", async () => {
    const utcPool = new pg.Pool({
      connectionString: server.connectionString,
      max: 1,
      types: createTemporalTypes(pg.types, { timestamp: "utc" }),
    });
    try {
      const { rows } = await utcPool.query("select '2026-11-07 14:30:00'::timestamp as t");
      expect(isInstant(rows[0].t)).toBe(true);
      expect(rows[0].t.toString()).toBe("2026-11-07T14:30:00Z");
    } finally {
      await utcPool.end();
    }
  });
});
