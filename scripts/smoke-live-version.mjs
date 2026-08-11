/**
 * After Firebase Hosting deploy — prove live /version.json matches this commit.
 * Retries while CDN/hosting settles. Fails the job if BO or POS lag behind source.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ATTEMPTS = Number(process.env.LIVE_VERSION_SMOKE_ATTEMPTS || 15);
const DELAY_MS = Number(process.env.LIVE_VERSION_SMOKE_DELAY_MS || 8000);

const SHOP_VERSION_URL =
  process.env.SHOP_VERSION_URL || "https://telltea-bo.web.app/version.json";
const POS_VERSION_URL =
  process.env.POS_VERSION_URL || "https://telltea-pos.web.app/pos-version.json";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readBuild(file, constName) {
  const src = readFileSync(join(root, file), "utf8");
  const match = src.match(new RegExp(`export const ${constName} = (\\d+)`));
  if (!match) throw new Error(`${constName} not found in ${file}`);
  return Number(match[1]);
}

const expectedApp = readBuild("src/lib/version.ts", "APP_BUILD");
const expectedPos = readBuild("src/lib/pos-version.ts", "POS_BUILD");

async function fetchBuild(url) {
  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
    cache: "no-store",
    redirect: "follow",
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  const text = await res.text();
  if (/Site Not Found/i.test(text)) {
    throw new Error(
      `${url} → Firebase Hosting Site Not Found (site missing or no release)`,
    );
  }
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${url} → not JSON (got ${text.slice(0, 80).replace(/\s+/g, " ")})`);
  }
  const build = Number(data.build);
  if (!Number.isFinite(build)) throw new Error(`${url} → missing numeric build`);
  return { build, version: data.version || data.product || "", raw: data };
}

async function waitForBuild(label, url, expected) {
  let lastErr;
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      const hit = await fetchBuild(url);
      if (hit.build < expected) {
        throw new Error(
          `${url} still at build ${hit.build} (want ≥ ${expected})`,
        );
      }
      console.log(
        `OK ${label} live build ${hit.build}` +
          (hit.version ? ` (${hit.version})` : "") +
          ` · attempt ${i}/${ATTEMPTS}`,
      );
      return hit;
    } catch (err) {
      lastErr = err;
      console.warn(`WARN ${label} attempt ${i}/${ATTEMPTS}:`, err.message || err);
      if (i < ATTEMPTS) await sleep(DELAY_MS);
    }
  }
  throw lastErr;
}

console.log(`Expect APP_BUILD=${expectedApp} · POS_BUILD=${expectedPos}`);
await waitForBuild("telltea-bo version.json", SHOP_VERSION_URL, expectedApp);
await waitForBuild("telltea-pos pos-version.json", POS_VERSION_URL, expectedPos);
console.log("OK smoke-live-version");
