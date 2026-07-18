/**
 * After Firebase Hosting deploy — prove install page + APK are publicly reachable.
 * Fail the job if either URL is still 404.
 */
const INSTALL = process.env.POS_INSTALL_URL || "https://telltea-pos.web.app/install/";
const APK = process.env.POS_APK_URL || "https://telltea-pos.web.app/downloads/telltea-pos.apk";
const ATTEMPTS = Number(process.env.POS_LIVE_SMOKE_ATTEMPTS || 8);
const DELAY_MS = Number(process.env.POS_LIVE_SMOKE_DELAY_MS || 5000);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchOk(url, { expectBinary = false } = {}) {
  const res = await fetch(url, { redirect: "follow" });
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}`);
  }
  if (expectBinary) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 10_000) {
      throw new Error(`${url} → body too small (${buf.length} bytes)`);
    }
    // APK / ZIP local file header
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
      throw new Error(`${url} → not an APK/ZIP (got content-type ${ct})`);
    }
    return buf.length;
  }
  const text = await res.text();
  if (!/TellTea POS/i.test(text) || !/telltea-pos\.apk/i.test(text)) {
    throw new Error(`${url} → page missing TellTea POS download markup`);
  }
  if (/This page could not be found/i.test(text)) {
    throw new Error(`${url} → still Next.js 404`);
  }
  return text.length;
}

async function waitFor(label, fn) {
  let lastErr;
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      const detail = await fn();
      console.log(`OK ${label} (attempt ${i}/${ATTEMPTS})`, detail);
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`WARN ${label} attempt ${i}/${ATTEMPTS}:`, err.message || err);
      if (i < ATTEMPTS) await sleep(DELAY_MS);
    }
  }
  throw lastErr;
}

await waitFor("install page", () => fetchOk(INSTALL));
await waitFor("APK file", () => fetchOk(APK, { expectBinary: true }));
console.log("\nLive POS install URLs OK");
