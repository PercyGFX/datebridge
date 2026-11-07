# datebridge

Save, send and show dates correctly across your frontend, backend and database.

Most date bugs are not date-math bugs. They happen when a date moves between layers:

- A user picks **Nov 7**, and the database saves **Nov 6**.
- `pg` returns a `date` column as a `Date` at midnight in the server's timezone, and it shifts a day in JSON.
- An API sends `"2026-11-07T14:30"` with no timezone, so nobody knows which moment it means.

datebridge fixes this with one rule, built on [Temporal](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal):

| Your value means... | Examples | Type | Postgres | JSON |
|---|---|---|---|---|
| **One exact moment** | bet placed at, created at, expires at | `Temporal.Instant` | `timestamptz` | `"2026-11-07T14:30:00Z"` |
| **A calendar day** | birthday, promo ends, game day | `Temporal.PlainDate` | `date` | `"2026-11-07"` |

A calendar day never becomes a timestamp, so it can't shift. Exact moments are always sent in UTC
and only converted to a timezone when you show them.

## Install

```sh
npm install datebridge
npm install temporal-polyfill   # needed for Safari and Node.js below 26
```

Load the polyfill once, at the top of your app. It uses built-in Temporal where it exists
(Chrome, Edge, Firefox, Node 26+):

```ts
import "temporal-polyfill/global";
```

## Frontend

```ts
import { formatInstant, formatDate, formatRelative, fromDateInput, toDateInput } from "datebridge";

// Show an exact moment in the user's timezone
formatInstant(bet.placedAt);                              // "Nov 7, 2026, 8:00 PM" (in Kolkata)
formatInstant(bet.placedAt, { timeZone: "Europe/London", locale: "en-GB" });

// Show a calendar day: the same day for every user
formatDate(promo.endsOn);                                 // "Nov 30, 2026"

formatRelative(bet.placedAt);                             // "5 minutes ago"
formatRelative(promo.endsOn);                             // "in 3 days" / "tomorrow"

// <input type="date">: use .value, never .valueAsDate
const endsOn = fromDateInput(input.value);                // PlainDate | null
input.value = toDateInput(promo.endsOn);
```

For `<input type="datetime-local">`, use `fromDateTimeInput(value, timeZone?)` and
`toDateTimeInput(instant, timeZone?)`.

## Sending dates over the API

Temporal values turn into the right strings in `JSON.stringify` by themselves. To read them back:

```ts
import { instant, plainDate } from "datebridge";

const placedAt = instant(json.placedAt);   // "2026-11-07T14:30:00Z" -> Instant
const gameDay = plainDate(json.gameDay);   // "2026-11-07" -> PlainDate
```

## Validation: zod, Joi, Yup

Validate whole payloads and get Temporal values out.

**zod 4**

```ts
import { z } from "zod";
import { zInstant, zPlainDate } from "datebridge/zod";

const Bet = z.object({ placedAt: zInstant(), gameDay: zPlainDate() });

const bet = Bet.parse(body);        // strings -> Temporal
const json = z.encode(Bet, bet);    // Temporal -> strings
```

**Joi 17+**

```ts
import BaseJoi from "joi";
import { extendJoi } from "datebridge/joi";

const Joi = extendJoi(BaseJoi);   // adds Joi.instant() and Joi.plainDate()

const Bet = Joi.object({
  placedAt: Joi.instant().required(),
  gameDay: Joi.plainDate().required(),
});
const { value, error } = Bet.validate(req.body);
```

In plain JavaScript you can also use `BaseJoi.extend(...joiTemporal)`.

**Yup 1**

```ts
import { object } from "yup";
import { yupInstant, yupPlainDate } from "datebridge/yup";

const Bet = object({
  placedAt: yupInstant().required(),
  gameDay: yupPlainDate().required(),
});
const bet = await Bet.validate(form);   // types are inferred: bet.placedAt is Temporal.Instant
```

All three reject the values behind day-shift bugs, with a message that says what went wrong:

```
"2026-11-06T18:30:00.000Z" is a timestamp, not a calendar date. Which day it falls on
depends on the timezone: use plainDateIn(value, timeZone).
```

## Postgres with `pg`

```ts
import pg from "pg";
import { now, today } from "datebridge";
import { useTemporalTypes, toPg } from "datebridge/pg";

useTemporalTypes(pg.types); // every query now returns Temporal values

const { rows } = await pool.query(
  "insert into bets (placed_at, game_day) values ($1, $2) returning *",
  toPg([now(), today("Europe/London")]),
);
rows[0].placed_at; // Temporal.Instant
rows[0].game_day;  // Temporal.PlainDate
```

| Postgres | You get |
|---|---|
| `date` | `Temporal.PlainDate` |
| `timestamptz` | `Temporal.Instant` |
| `timestamp` | `Temporal.PlainDateTime` (or `Instant` with `{ timestamp: "utc" }`) |
| `time` | `Temporal.PlainTime` |
| arrays of these | arrays of Temporal values |

Wrap parameters in `toPg()`. Without it, `pg` sends Temporal values as quoted JSON and Postgres
rejects them. To enable this for one pool only, use
`new pg.Pool({ types: createTemporalTypes(pg.types) })`.

## Drizzle ORM (Postgres)

```ts
import { pgTable, serial } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { instantColumn, plainDateColumn } from "datebridge/drizzle";

export const bets = pgTable("bets", {
  id: serial("id").primaryKey(),
  placedAt: instantColumn("placed_at").notNull().default(sql`now()`),  // timestamptz
  gameDay: plainDateColumn("game_day").notNull(),                       // date
});
```

## Backend helpers

```ts
import { now, today, dayRange, plainDateIn } from "datebridge";

today("Europe/London");                        // PlainDate: today's date in London
plainDateIn(bet.placedAt, "Asia/Tokyo");       // which day the bet was placed, in Tokyo

// "All bets placed on Nov 7, in the player's timezone"
const { start, end } = dayRange("2026-11-07", player.timeZone);
db.select().from(bets).where(and(gte(bets.placedAt, start), lt(bets.placedAt, end)));
```

`dayRange` handles 23- and 25-hour days around daylight saving changes.

## Rules that prevent most date bugs

1. **Store exact moments in `timestamptz`, not `timestamp`.**
2. **Store calendar days in `date`, as `"YYYY-MM-DD"` strings end to end.**
3. **Store users' timezones as IANA names** (`"Europe/London"`), not offsets (`+01:00`). Offsets change with daylight saving.
4. **Convert to a timezone only when you display.**
5. **Run servers with `TZ=UTC`.**
6. **Use server time for anything that matters** (expiry, bonus windows). Client clocks can be wrong.

## Backends in other languages (Go, Python, Java...)

You only need datebridge on the frontend. The contract is two string formats, which every
language can read and write:

| Value | Send as | Go type |
|---|---|---|
| Exact moment | `"2026-11-07T14:30:00Z"` | `time.Time` (its JSON is already this format) |
| Calendar date | `"2026-11-07"` | `civil.Date` from `cloud.google.com/go/civil`, or `string` |

Don't use `time.Time` for date-only fields: Go can't read `"2026-11-07"` into it. If a backend
sends dates as midnight timestamps (`"2026-11-07T00:00:00Z"` or `"...T00:00:00+00:00"`),
`plainDate()` and the validators still read them as the right day.

## API

From `datebridge`:

| Function | What it does |
|---|---|
| `instant(value)` | ISO string with Z/offset, `Date`, epoch ms, ZonedDateTime → `Instant` |
| `plainDate(value)` | `"YYYY-MM-DD"`, `{ year, month, day }`, midnight `Date` → `PlainDate` |
| `plainDateIn(value, timeZone)` | The day a moment falls on in a timezone |
| `dayRange(date, timeZone)` | `{ start, end }` instants of a day in a timezone |
| `now()`, `today(timeZone?)`, `userTimeZone()` | Current moment, date and timezone |
| `formatInstant(value, options?)` | Display a moment (Intl options + `locale`, `timeZone`) |
| `formatDate(value, options?)` | Display a calendar day |
| `formatRelative(value, options?)` | "5 minutes ago", "tomorrow" |
| `inTimeZone(value, timeZone?)` | `ZonedDateTime` for custom formatting |
| `fromDateInput`, `toDateInput` | `<input type="date">` ↔ `PlainDate` |
| `fromDateTimeInput`, `toDateTimeInput` | `<input type="datetime-local">` ↔ `Instant` |
| `toDate(value)` | `Instant` → legacy `Date`, for libraries that need one |
| `isInstant`, `isPlainDate`, ... | Type guards |
| `configure({ Temporal })` | Use a polyfill that isn't installed globally |

From `datebridge/pg`: `useTemporalTypes`, `createTemporalTypes`, `toPg`, `parse`, `formatForPostgres`, `PG_TYPES`.
From `datebridge/drizzle`: `instantColumn`, `plainDateColumn`.
From `datebridge/zod`: `zInstant`, `zPlainDate`.
From `datebridge/joi`: `extendJoi`, `joiTemporal`.
From `datebridge/yup`: `yupInstant`, `yupPlainDate`.

Errors are thrown as `DateBridgeError`, with a message that says how to fix the problem.

## Support

- **Browsers:** Chrome 67+, Firefox 68+, Safari 14+, Edge 79+ with `temporal-polyfill`. Built-in Temporal is used where available.
- **Node.js:** 20.19+. Node 26+ has Temporal built in.
- **TypeScript:** works with or without the built-in Temporal types (`lib: esnext` in TypeScript 7).
- **ESM only.** `require("datebridge")` works on Node 20.19+.

The test suite runs against real Postgres in five timezones: UTC, UTC+14, UTC−11, UTC+5:30 and
New York (daylight saving).

## Roadmap

Prisma (once Prisma 8 is stable), NestJS (class-validator), Valibot, mysql2, postgres.js, TypeORM,
Sequelize, MikroORM, Mongoose.

## License

MIT
