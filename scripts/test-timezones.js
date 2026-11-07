// Runs the whole test suite once per timezone. Day-shift bugs only show up when the
// machine is ahead of or behind UTC, so a suite that passes in UTC proves very little.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const zones = [
  "UTC",
  "Pacific/Kiritimati", // UTC+14, the earliest timezone
  "Pacific/Pago_Pago", // UTC-11, one of the latest
  "Asia/Kolkata", // UTC+5:30, a half-hour offset
  "America/New_York", // has daylight saving time
];

const vitestPackage = createRequire(import.meta.url).resolve("vitest/package.json");
const vitest = join(dirname(vitestPackage), "vitest.mjs");
const extraArgs = process.argv.slice(2);
const failed = [];

for (const zone of zones) {
  console.log(`\n=== TZ=${zone} ===`);
  const result = spawnSync(process.execPath, [vitest, "run", ...extraArgs], {
    stdio: "inherit",
    env: { ...process.env, TZ: zone },
  });
  if (result.status !== 0) failed.push(zone);
}

if (failed.length > 0) {
  console.error(`\nFailed in: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\nAll tests passed in ${zones.length} timezones.`);
