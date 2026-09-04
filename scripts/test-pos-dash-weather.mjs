/**
 * Gate: POS daily sales table weather (Udon / TMD + locked history).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 721);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)[1]) >= 183);

assert.ok(existsSync(join(root, "functions/pos-weather.js")));
assert.ok(existsSync(join(root, "src/lib/pos-weather.ts")));
assert.ok(existsSync(join(root, "docs/pos-dash-weather-checklist.md")));

const fn = read("functions/pos-weather.js");
assert.match(fn, /ensurePosWeatherDays/);
assert.match(fn, /posWeatherFinalizeDaily/);
assert.match(fn, /WeatherToday/);
assert.match(fn, /อุดรธานี|48354/);
assert.match(fn, /status === "final"|status: "final"/);
assert.match(fn, /open-meteo|fetchHistoryRange/);
assert.match(fn, /periods/);

const idx = read("functions/index.js");
assert.match(idx, /ensurePosWeatherDays/);
assert.match(idx, /posWeatherFinalizeDaily/);

const lib = read("src/lib/pos-weather.ts");
assert.match(lib, /ensurePosWeatherDays/);
assert.match(lib, /weatherDays/);
assert.match(lib, /weatherCellTitle/);
assert.match(lib, /WEATHER_TODAY_REFRESH_MS|45 \* 60/);
assert.match(lib, /keysNeedingFetch/);
assert.match(lib, /fetchOpenMeteoWeatherDays|open-meteo-client/);
assert.match(fn, /TODAY_REFRESH_MS|usableDoc/);
assert.match(fn, /Already saved once|never re-fetch|seal/);
assert.match(fn, /staff\.get\("role"\) === "owner"/);

const charts = read("src/components/PosSalesDashboardCharts.tsx");
assert.match(charts, /weatherByDay/);
assert.match(charts, /pos-dash-day-weather/);
assert.match(charts, /กลางวัน|เย็น|ดึก|periods/);
assert.match(charts, /weatherLoading/);

const dash = read("src/components/PosSalesDashboard.tsx");
assert.match(dash, /ensurePosWeatherDays/);
assert.match(dash, /weatherByDay/);
assert.match(dash, /weatherDateKeys/);
assert.match(dash, /weatherLoading/);

const rules = read("firestore.rules");
assert.match(rules, /match \/weatherDays\/\{dateId\}/);
assert.match(rules, /allow write: if false/);
assert.match(rules, /collection != 'weatherDays'/);

const css = read("src/app/globals.css");
assert.match(css, /minmax\(20rem/);
assert.match(css, /pos-dash-daily-block/);

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 877);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)[1]) >= 219);

const doc = read("docs/pos-dash-weather-checklist.md");
assert.match(doc, /กรมอุตุ|TMD|อุดร/);
assert.match(doc, /final|ล็อก/);

console.log("OK test-pos-dash-weather");
