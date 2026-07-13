/**
 * Shared Playwright harness for TellTea POS e2e.
 * วัดเวลา + สังเกตปัญหา (ช้า, คลิกไม่ตอบ, error บนหน้า)
 */
import assert from "node:assert/strict";
import { chromium, devices } from "playwright";

/** ms — เป้าหม้าร้าน (warn) / ขีดล้ม CI (fail). ปรับด้วย env POS_E2E_STRICT=1 ให้เข้มขึ้น */
export const POS_E2E_BUDGETS = {
  boot_ready: { warn: 12_000, fail: 45_000, label: "โหลด POS → พร้อมขาย" },
  menu_nav: { warn: 2_500, fail: 8_000, label: "คลิกเฟือง → หน้าเมนู" },
  menu_auth: { warn: 6_000, fail: 20_000, label: "หน้าเมนู auth + แท็บ" },
  open_shift: { warn: 5_000, fail: 15_000, label: "เปิดขายกะ" },
  sell_grid: { warn: 8_000, fail: 25_000, label: "โหลดกริดเมนูขาย" },
  tap_to_cart: { warn: 800, fail: 3_000, label: "แตะเมนู → ตะกร้า" },
  option_picker: { warn: 1_200, fail: 4_000, label: "popup ตัวเลือก → ตะกร้า" },
  cash_checkout: { warn: 2_000, fail: 8_000, label: "เงินสด → ยืนยันขาย" },
  nav_roundtrip: { warn: 5_000, fail: 15_000, label: "ขาย ↔ เมนู ไปกลับ" },
};

export const POS_E2E_URL = process.env.POS_E2E_URL || "https://telltea-pos.web.app/pos/";

export function tabletDevice() {
  return devices[process.env.POS_E2E_DEVICE || "iPhone 13"];
}

export class PosE2eReport {
  constructor(suite) {
    this.suite = suite;
    this.steps = [];
    this.observations = [];
    this.errors = [];
    this.failed = false;
  }

  note(msg) {
    this.observations.push(msg);
    console.log(`[OBS]  ${msg}`);
  }

  async timed(step, budgetKey, fn) {
    const budget = POS_E2E_BUDGETS[budgetKey];
    const t0 = performance.now();
    let thrown = null;
    try {
      await fn();
    } catch (err) {
      thrown = err;
    }
    const ms = Math.round(performance.now() - t0);
    const row = { step, budgetKey, ms, budget, ok: !thrown };

    if (thrown) {
      row.ok = false;
      row.error = thrown.message;
      this.failed = true;
      console.error(`[FAIL] ${budget?.label || step} ${ms}ms — ${thrown.message}`);
    } else if (budget && ms > budget.fail) {
      this.failed = true;
      row.slow = "fail";
      console.error(`[FAIL] ${budget.label} ${ms}ms — ช้าเกิน ${budget.fail}ms`);
    } else if (budget && ms > budget.warn) {
      row.slow = "warn";
      console.log(`[WARN] ${budget.label} ${ms}ms — ช้ากว่าเป้า ${budget.warn}ms`);
    } else {
      console.log(`[PASS] ${budget?.label || step} ${ms}ms`);
    }

    this.steps.push(row);
    if (thrown) throw thrown;
    return ms;
  }

  attachPage(page) {
    page.on("pageerror", (e) => this.errors.push(`page: ${e.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") this.errors.push(`console: ${msg.text()}`);
    });
    page.on("dialog", async (dialog) => {
      if (dialog.type() === "prompt") {
        await dialog.accept(`e2e-${Date.now().toString(36)}`);
      } else {
        await dialog.accept();
      }
    });
  }

  summary() {
    const warns = this.steps.filter((s) => s.slow === "warn").length;
    return {
      suite: this.suite,
      passed: !this.failed,
      steps: this.steps,
      observations: this.observations,
      errors: this.errors.filter(
        (e) => !e.includes("418") && !e.includes("favicon") && !e.includes("net::ERR"),
      ),
      warnCount: warns,
    };
  }

  printSummary() {
    console.log(`\n=== ${this.suite} summary ===`);
    for (const s of this.steps) {
      const tag = !s.ok ? "FAIL" : s.slow === "warn" ? "WARN" : "PASS";
      console.log(`  ${tag}  ${s.budget?.label || s.step}: ${s.ms}ms`);
    }
    if (this.observations.length) {
      console.log("  สังเกต:");
      for (const o of this.observations) console.log(`    - ${o}`);
    }
    const hydration = this.errors.filter((e) => e.includes("418"));
    if (hydration.length) {
      console.log(`  WARN React hydration #418 ×${hydration.length}`);
    }
  }
}

export async function launchPosE2e() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...tabletDevice() });
  const page = await context.newPage();
  return { browser, context, page };
}

export async function gotoPos(page, url = POS_E2E_URL) {
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  assert.ok(res && res.status() < 400, `HTTP ${res?.status()}`);
}

export async function waitPosBoot(page, timeout = POS_E2E_BUDGETS.boot_ready.fail) {
  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      return (
        t.includes("พร้อมขาย")
        || t.includes("กดค้างเมนู")
        || t.includes("เชื่อมต่อไม่สำเร็จ")
      );
    },
    { timeout },
  );
  const text = await page.locator("body").innerText();
  if (text.includes("เชื่อมต่อไม่สำเร็จ")) {
    throw new Error("POS boot ล้มเหลว — Firebase/auth");
  }
}

export function isSelling(page) {
  return page.locator("body").innerText().then((t) => t.includes("กดค้างเมนู"));
}

export async function ensureSelling(page, report) {
  if (await isSelling(page)) return;

  await report.timed("open_shift", "open_shift", async () => {
    const btn = page.getByRole("button", { name: "เปิดขายกะนี้" });
    await btn.waitFor({ state: "visible", timeout: 10_000 });
    await btn.click();
    await page.waitForFunction(
      () => document.body.innerText.includes("กดค้างเมนู"),
      { timeout: POS_E2E_BUDGETS.open_shift.fail },
    );
  });
}

export async function waitSellGrid(page, report) {
  await report.timed("sell_grid", "sell_grid", async () => {
    const items = page.locator(".pos-sell-item:not(.pos-sell-item--soldout)");
    await items.first().waitFor({ state: "visible", timeout: POS_E2E_BUDGETS.sell_grid.fail });
    const count = await items.count();
    if (count === 0) {
      report.note("ไม่มีเมนูขายที่กดได้ — อาจยังไม่ seed เมนู");
      throw new Error("กริดเมนูว่าง");
    }
    report.note(`เมนูขายพร้อมกด ${count} รายการ`);
  });
}

/** แตะเมนูแรก — รองรับ popup ตัวเลือก */
export async function tapFirstItemToCart(page, report) {
  const item = page.locator(".pos-sell-item:not(.pos-sell-item--soldout)").first();
  const t0 = performance.now();

  await item.click();

  const picker = page.locator(".pos-option-picker");
  if (await picker.isVisible().catch(() => false)) {
    const pickerMs = Math.round(performance.now() - t0);
    const budget = POS_E2E_BUDGETS.option_picker;
    if (pickerMs > budget.fail) {
      report.failed = true;
      console.error(`[FAIL] ${budget.label} ${pickerMs}ms`);
    } else if (pickerMs > budget.warn) {
      console.log(`[WARN] ${budget.label} ${pickerMs}ms`);
    } else {
      console.log(`[PASS] ${budget.label} ${pickerMs}ms`);
    }

    const choice = page.locator(".pos-option-choice-btn").first();
    if (await choice.count()) await choice.click();
    await page.getByRole("button", { name: /เพิ่มตะกร้า/ }).click();
  }

  await page.waitForFunction(
    () => {
      const cashBtn = [...document.querySelectorAll("button")].find(
        (b) => b.textContent?.includes("เงินสด") && !b.disabled,
      );
      return !!cashBtn || !!document.querySelector(".pos-sell-item-qty");
    },
    { timeout: POS_E2E_BUDGETS.tap_to_cart.fail },
  );

  const ms = Math.round(performance.now() - t0);
  const budget = POS_E2E_BUDGETS.tap_to_cart;
  if (ms > budget.fail) {
    report.failed = true;
    console.error(`[FAIL] ${budget.label} ${ms}ms — เกิน ${budget.fail}ms`);
  } else if (ms > budget.warn) {
    console.log(`[WARN] ${budget.label} ${ms}ms — ช้ากว่าเป้า ${budget.warn}ms`);
  } else {
    console.log(`[PASS] ${budget.label} ${ms}ms`);
  }
  report.steps.push({ step: "tap_to_cart", ms, budget });
}

export async function cashCheckout(page, report) {
  await report.timed("cash_checkout", "cash_checkout", async () => {
    await page.getByRole("button", { name: "เงินสด" }).click();
    await page.locator(".pos-pay-modal").waitFor({ state: "visible" });
    const input = page.locator(".pos-pay-field input");
    const total = await input.inputValue();
    const amount = String(Math.max(100, Number(total) || 50));
    await input.fill(amount);
    await page.getByRole("button", { name: "ยืนยันขาย" }).click();
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("บันทึกแล้ว")
        || document.querySelector(".pos-sell-flash"),
      { timeout: POS_E2E_BUDGETS.cash_checkout.fail },
    );
  });
}

export function finishReport(report) {
  report.printSummary();
  const s = report.summary();
  if (!s.passed) {
    process.exitCode = 1;
    console.error(`\n${report.suite} FAILED`);
  } else {
    console.log(`\nOK ${report.suite}`);
  }
  return s;
}
