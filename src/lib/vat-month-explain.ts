/**
 * ที่มาของตัวเลขแต่ละแถวในหน้า VAT เดือน (A/B/C/D) — โชว์อย่างเดียว
 * แตะชื่อแถว → popup: สูตร · ตัวเลขที่ประกอบ · แหล่งข้อมูล · ข้อควรรู้
 * ไม่คิดตัวเลขใหม่ — อ่านจาก view / draft / สองบช. ที่หน้าโชว์อยู่แล้ว
 */
import type { MonthCategoryRow } from "./pnl";
import { DELIVERY_COL_INFO } from "./vat-month-sources";
import {
  MONTH_CHANNEL_LABEL,
  MONTH_CHANNEL_SHORT,
  MONTH_CHANNELS,
  type MonthBooksDraft,
  type MonthBooksView,
  type MonthChannel,
} from "./vat-month-books";

export type CalcTerm = {
  label: string;
  amount: number | null;
  /** เครื่องหมายหน้าแถว — แถวแรกไม่ต้องใส่ · × = ตัวคูณ (label คืออัตรา ไม่ต้องใส่ × ซ้ำ) */
  op?: "+" | "−" | "×";
  /** ผลรวมคั่นกลางก่อนคูณ — ไม่นับรวมซ้ำ */
  subtotal?: boolean;
  hint?: string;
};

export type CalcLink = { href: string; label: string };

export type CalcExplain = {
  title: string;
  result: number | null;
  /** หน่วยของผลลัพธ์ (ค่าเริ่ม บาท) */
  resultSuffix?: string;
  formula: string;
  terms: CalcTerm[];
  sources: string[];
  notes: string[];
  links: CalcLink[];
};

export type ExplainCtx = {
  monthLabel: string;
  view: MonthBooksView;
  draft: MonthBooksDraft;
  staff: MonthCategoryRow | null;
  owner: MonthCategoryRow | null;
  /** รอบตัดยอด VAT เช่น «1 ต.ค. – 31 ต.ค. 2569» */
  periodLabel: string;
  periodStartDay: number;
  sf: {
    posConnected: boolean;
    pct: number;
    posCash: number;
    posTransfer: number;
  };
  claimedBooksCount: number;
  /** ผลรวม VAT ของรายการที่ติ๊ก — เทียบกับช่องที่แก้มือได้ */
  claimedBooksVat: number;
  booksLineCount: number;
};

export type DeliveryCol = keyof typeof DELIVERY_COL_INFO;

export type ExplainId =
  | `col.${DeliveryCol}`
  | "a.delivery"
  | `a.ch.${MonthChannel}`
  | "a.storefront"
  | "a.income"
  | "b.gp"
  | `b.gp.${MonthChannel}`
  | "b.books"
  | "b.books.staff"
  | "b.books.owner"
  | "b.asset"
  | "b.layer.claimed"
  | "b.layer.vat"
  | "b.layer.unclaimed"
  | "b.costTotal"
  | "c.income"
  | "c.cogs"
  | "c.grossProfit"
  | "c.otherOpex"
  | "c.operatingProfit"
  | "c.netVat"
  | "c.netProfit"
  | "d.salesDelivery"
  | "d.salesStorefront"
  | "d.salesTotal"
  | "d.gpVat"
  | `d.gpVat.${MonthChannel}`
  | "d.booksVat"
  | "d.booksVatApplied"
  | "d.inputTotal";

const LINK_LEDGER: CalcLink = { href: "/ledger/", label: "บัญชีพนักงาน" };
const LINK_OWNER: CalcLink = { href: "/owner-books/", label: "บัญชีเจ้าของ" };
const LINK_SOURCES: CalcLink = { href: "/vat-sales/sources/", label: "แหล่งนำเข้ายอดเดลิเวอรี่" };

function r2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function n0(v: number | null | undefined): number {
  return Number.isFinite(v as number) ? Number(v) : 0;
}

/** ยังโหลดสองบช.ไม่ครบ → null ทั้งหมด (ไม่โชว์ 0.00 หลอก) */
function booksSumBy(
  ctx: ExplainCtx,
  key: "cogs" | "sga" | "other" | "asset" | "vatCogs",
): { staff: number | null; owner: number | null; total: number | null } {
  if (!ctx.staff || !ctx.owner) return { staff: null, owner: null, total: null };
  const staff = n0(ctx.staff[key]);
  const owner = n0(ctx.owner[key]);
  return { staff, owner, total: r2(staff + owner) };
}

function sumOrNull(...xs: Array<number | null>): number | null {
  if (xs.some((x) => x == null)) return null;
  return r2(xs.reduce<number>((s, x) => s + (x as number), 0));
}

function bookRowOp(row: MonthCategoryRow | null): number | null {
  return row ? r2(row.cogs + row.sga + row.other) : null;
}

/** คชจ.บช. นับตามเดือนปฏิทิน — เตือนเมื่อรอบ VAT ไม่ได้เริ่มวันที่ 1 */
function periodNote(ctx: ExplainCtx): string[] {
  if (ctx.periodStartDay === 1) return [];
  return [
    `คชจ.จากสองบช. นับตามเดือนปฏิทิน (วันที่ 1–สิ้นเดือน) แต่รอบ VAT ตั้งไว้ ${ctx.periodLabel} — ช่วงวันอาจไม่ตรงกัน`,
  ];
}

function booksMissingNote(ctx: ExplainCtx): string[] {
  return ctx.staff && ctx.owner ? [] : ["ยังโหลดสองบช.ไม่เสร็จ — ตัวเลขจะขึ้นหลังโหลดครบ"];
}

const CLAIM_RULE =
  "รายการที่ติ๊ก «หักภาษีซื้อ» นับต้นทุน = ยอดบิล − VAT (VAT ไปหักภาษีขายใน D) · ไม่ติ๊ก = นับบิลเต็มรวม VAT";

function channelTransferTerms(ctx: ExplainCtx): CalcTerm[] {
  return MONTH_CHANNELS.map((k, i) => ({
    label: `ยอดโอน ${MONTH_CHANNEL_LABEL[k]}`,
    amount: n0(ctx.draft.transfer[k]),
    op: i === 0 ? undefined : "+",
  }));
}

function storefrontSource(ctx: ExplainCtx): string {
  const { sf } = ctx;
  if (sf.posConnected && sf.posCash + sf.posTransfer > 0) {
    return `หน้าร้าน ← ดึงจาก nPOS ตามวันบิล (สด ${fmtPlain(sf.posCash)} + พร้อมเพย์/โอน ${fmtPlain(sf.posTransfer)}) × ${sf.pct}% จากแถบ «ส่งหน้าร้าน»`;
  }
  return "หน้าร้าน ← ใส่มือในช่องหน้าร้าน หรือแถบ «ส่งหน้าร้าน» (ยอดต้นทาง × %)";
}

function fmtPlain(n: number): string {
  return (Number(n) || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function explainIncome(ctx: ExplainCtx, title: string): CalcExplain {
  return {
    title,
    result: ctx.view.incomeTotal,
    formula: "ยอดโอน ShopeeFood + Grab + LINE MAN + หน้าร้าน",
    terms: [
      ...channelTransferTerms(ctx),
      { label: "หน้าร้าน", amount: n0(ctx.draft.transfer.storefront), op: "+" },
    ],
    sources: [
      "ยอดโอนเดลิเวอรี่ ← ตาราง «ยอดเดลิเวอรี่» ด้านบน (นำเข้าจากแคป/เมลแพลตฯ หรือแก้มือ)",
      storefrontSource(ctx),
    ],
    notes: [
      "ใช้ยอดโอน (เงินถึงร้านหลังแพลตฯ หัก GP) — ไม่ใช่ยอดขายแอพ",
      "GP อยู่ในยอดโอนแล้ว จึงไม่หักซ้ำตอนคิดกำไร",
    ],
    links: [LINK_SOURCES],
  };
}

function explainCogs(ctx: ExplainCtx): CalcExplain {
  const c = booksSumBy(ctx, "cogs");
  const vat = booksSumBy(ctx, "vatCogs");
  return {
    title: "ต้นทุนขาย",
    result: c.total,
    formula: "ต้นทุน (cogs) บช.พนักงาน + ต้นทุน (cogs) บช.เจ้าของ",
    terms: [
      { label: "บช.พนักงาน · ประเภทต้นทุน", amount: c.staff },
      { label: "บช.เจ้าของ · ประเภทต้นทุน", amount: c.owner, op: "+" },
    ],
    sources: [
      `บัญชีพนักงาน — รายการจ่ายประเภท «ต้นทุน (cogs)» ที่ลงวันที่ใน${ctx.monthLabel}`,
      `บัญชีเจ้าของ — รายการจ่ายประเภท «ต้นทุน (cogs)» ที่ลงวันที่ใน${ctx.monthLabel}`,
    ],
    notes: [
      CLAIM_RULE,
      ...((vat.total ?? 0) > 0
        ? [`VAT ที่ตัดออกจากต้นทุนเดือนนี้ ${fmtPlain(vat.total ?? 0)} → ไปเป็นภาษีซื้อใน D`]
        : []),
      "รายการประเภท ค่าใช้จ่าย (sga) / อื่นๆ ไม่อยู่ในบรรทัดนี้ — ไปอยู่ «คชจ.ขาย/บริหาร + อื่นๆ»",
      "สินทรัพย์ (asset) ไม่หักกำไร",
      ...periodNote(ctx),
      ...booksMissingNote(ctx),
    ],
    links: [LINK_LEDGER, LINK_OWNER],
  };
}

function explainOtherOpex(ctx: ExplainCtx): CalcExplain {
  const sga = booksSumBy(ctx, "sga");
  const other = booksSumBy(ctx, "other");
  return {
    title: "คชจ.ขาย/บริหาร + อื่นๆ",
    result: sumOrNull(sga.total, other.total),
    formula: "ค่าใช้จ่าย (sga) + อื่นๆ ของสองบช.",
    terms: [
      { label: "บช.พนักงาน · ค่าใช้จ่าย (sga)", amount: sga.staff },
      { label: "บช.พนักงาน · อื่นๆ", amount: other.staff, op: "+" },
      { label: "บช.เจ้าของ · ค่าใช้จ่าย (sga)", amount: sga.owner, op: "+" },
      { label: "บช.เจ้าของ · อื่นๆ", amount: other.owner, op: "+" },
    ],
    sources: [
      `บัญชีพนักงาน + บัญชีเจ้าของ — รายการจ่ายใน${ctx.monthLabel} ที่ไม่ใช่ต้นทุน (cogs) และไม่ใช่สินทรัพย์`,
    ],
    notes: [
      "«อื่นๆ» = รายการที่ประเภทว่าง / ให้ AI จัดแต่ยังไม่ได้ประเภท / ประเภทพิมพ์เอง",
      "ไม่รวม GP แพลตฯ (หักในยอดโอนแล้ว)",
      CLAIM_RULE,
      ...periodNote(ctx),
      ...booksMissingNote(ctx),
    ],
    links: [LINK_LEDGER, LINK_OWNER],
  };
}

function explainNetVat(ctx: ExplainCtx, title: string): CalcExplain {
  const { view } = ctx;
  return {
    title,
    result: view.netVat,
    formula: view.includeInputVat
      ? "ภาษีขาย − ภาษีซื้อ (GP + สองบช.)"
      : "ภาษีขาย − 0 (ปิดการนำภาษีซื้อมาหัก)",
    terms: [
      { label: "ภาษีขาย เดลิเวอรี่", amount: view.delivery.outputVat },
      { label: "ภาษีขาย หน้าร้าน", amount: view.storefront.outputVat, op: "+" },
      ...(view.includeInputVat
        ? [
            { label: "ภาษีซื้อ GP", amount: view.inputGpVat, op: "−" as const },
            { label: "ภาษีซื้อสองบช.", amount: view.inputBooksVat, op: "−" as const },
          ]
        : [{ label: "ภาษีซื้อ (ยังไม่หัก)", amount: 0, op: "−" as const }]),
    ],
    sources: ["กล่อง D) VAT ด้านล่าง"],
    notes: [
      "ยอดบวก = ต้องนำส่งสรรพากร · ติดลบ = ได้คืน (บวกกลับเข้ากำไร)",
      ...(view.includeInputVat
        ? []
        : [`มีภาษีซื้อ ${fmtPlain(view.inputVat)} แต่ปิดติ๊ก «นำภาษีซื้อมารวมหัก» อยู่`]),
    ],
    links: [],
  };
}

function explainGpVatChannel(ctx: ExplainCtx, k: MonthChannel): CalcExplain {
  const override = n0(ctx.draft.gpVatOverride[k]);
  const fee = n0(ctx.draft.gpFee[k]);
  const pct = ctx.draft.outputPct || 7;
  return {
    title: `ภาษีซื้อ GP ${MONTH_CHANNEL_LABEL[k]}`,
    result: ctx.view.gpVatByChannel[k],
    formula:
      override > 0
        ? "ใช้ยอด VAT จากใบกำกับค่า GP ที่ใส่ไว้"
        : `ประมาณจาก คชจ.GP × ${pct}/${100 + pct}`,
    terms:
      override > 0
        ? [{ label: "VAT-ซื้อ ที่ใส่ไว้", amount: override }]
        : [
            { label: `คชจ.GP ${MONTH_CHANNEL_SHORT[k]}`, amount: fee },
            { label: `${pct}/${100 + pct} (VAT ในยอดรวม VAT)`, amount: null, op: "×" },
          ],
    sources: [`คอลัมน์ VAT-ซื้อ / คชจ.GP ของ ${MONTH_CHANNEL_LABEL[k]} ในตารางยอดเดลิเวอรี่`],
    notes: [
      "ใส่ยอดจากใบกำกับภาษีค่า GP จะแม่นกว่าการประมาณ",
      `ยอดซื้อ ภ.พ.30 = ภาษีซื้อ × 100/${pct}`,
    ],
    links: [LINK_SOURCES],
  };
}

const DELIVERY_COL_TITLE: Record<DeliveryCol, string> = {
  appSales: "ยอดขายแอพ",
  transfer: "ยอดโอน",
  gpFee: "คชจ.GP",
  otherFee: "คชจ.อื่นๆ",
  purchaseVat: "VAT-ซื้อ",
};

/** หัวคอลัมน์ตารางยอดเดลิเวอรี่ — ความหมาย + ยอดรวมแยกแอพ */
function explainDeliveryColumn(col: DeliveryCol, ctx: ExplainCtx): CalcExplain | null {
  const { draft } = ctx;
  const perChannel = (pick: (k: MonthChannel) => number): CalcTerm[] =>
    MONTH_CHANNELS.map((k, i) => ({
      label: MONTH_CHANNEL_LABEL[k],
      amount: n0(pick(k)),
      op: i === 0 ? undefined : ("+" as const),
    }));
  const sum = (pick: (k: MonthChannel) => number) =>
    r2(MONTH_CHANNELS.reduce((s, k) => s + n0(pick(k)), 0));
  const base = {
    title: DELIVERY_COL_TITLE[col],
    formula: DELIVERY_COL_INFO[col],
    sources: [
      "นำเข้าจากแคป/เมลสรุปเดือนของแต่ละแพลตฯ ที่หน้าแหล่งนำเข้า หรือพิมพ์แก้ในตารางนี้",
    ],
    links: [LINK_SOURCES],
  };
  switch (col) {
    case "appSales":
      return {
        ...base,
        result: sum((k) => draft.sales[k]),
        terms: perChannel((k) => draft.sales[k]),
        notes: ["ไปคิดภาษีขายใน D (× 7%) — ไม่ใช่รายได้"],
      };
    case "transfer":
      return {
        ...base,
        result: sum((k) => draft.transfer[k]),
        terms: perChannel((k) => draft.transfer[k]),
        notes: ["ไปเป็นรายได้ถึงร้านใน A"],
      };
    case "gpFee":
      return {
        ...base,
        result: sum((k) => draft.gpFee[k]),
        terms: perChannel((k) => draft.gpFee[k]),
        notes: ["โชว์อ้างอิงใน B · ใช้ประมาณภาษีซื้อ GP ใน D เมื่อไม่ได้ใส่ VAT-ซื้อ"],
      };
    case "otherFee": {
      const sales = sum((k) => draft.sales[k]);
      const transfer = sum((k) => draft.transfer[k]);
      const gp = sum((k) => draft.gpFee[k]);
      const ok = sales > 0 && transfer > 0;
      return {
        ...base,
        result: ok ? r2(sales - transfer - gp) : null,
        terms: ok
          ? [
              { label: "ยอดขายแอพรวม", amount: sales },
              { label: "ยอดโอนรวม", amount: transfer, op: "−" },
              { label: "คชจ.GP รวม", amount: gp, op: "−" },
            ]
          : [],
        sources: ["คำนวณอัตโนมัติจากคอลัมน์ยอดขายแอพ / ยอดโอน / คชจ.GP"],
        notes: ok ? [] : ["ต้องมีทั้งยอดขายแอพและยอดโอนก่อนจึงคิดได้"],
      };
    }
    case "purchaseVat":
      return {
        ...base,
        result: sum((k) => draft.gpVatOverride[k]),
        terms: perChannel((k) => draft.gpVatOverride[k]),
        notes: [
          "ช่องว่าง = ใน D จะประมาณจาก คชจ.GP × 7/107 แทน",
          "ใส่ยอดจากใบกำกับภาษีค่า GP จะแม่นที่สุด",
        ],
      };
    default:
      return null;
  }
}

/** คืนคำอธิบายของแถว — null ถ้าไม่รู้จัก id */
export function explainVatMonthRow(id: ExplainId, ctx: ExplainCtx): CalcExplain | null {
  const { view, draft } = ctx;
  const pct = draft.outputPct || 7;

  if (id.startsWith("col.")) {
    const col = id.slice(4) as DeliveryCol;
    return col in DELIVERY_COL_INFO ? explainDeliveryColumn(col, ctx) : null;
  }

  if (id.startsWith("a.ch.")) {
    const k = id.slice(5) as MonthChannel;
    if (!MONTH_CHANNELS.includes(k)) return null;
    const sales = n0(draft.sales[k]);
    const transfer = n0(draft.transfer[k]);
    const gp = n0(draft.gpFee[k]);
    const canBreak = sales > 0 && transfer > 0;
    return {
      title: `ยอดโอน ${MONTH_CHANNEL_LABEL[k]}`,
      result: transfer,
      formula: "เงินที่แพลตฯ โอนเข้าบัญชีร้านในเดือนนี้ (หลังหัก GP + คชจ.อื่นๆ)",
      terms: canBreak
        ? [
            { label: "ยอดขายแอพ", amount: sales },
            { label: "คชจ.GP", amount: gp, op: "−" },
            { label: "คชจ.อื่นๆ (ส่วนต่างที่เหลือ)", amount: r2(sales - transfer - gp), op: "−" },
          ]
        : [{ label: `ยอดโอน ${MONTH_CHANNEL_SHORT[k]} ที่ใส่ไว้`, amount: transfer }],
      sources: [
        `ช่องยอดโอน ${MONTH_CHANNEL_SHORT[k]} ในตารางยอดเดลิเวอรี่ — นำเข้าจากแคป/เมลสรุปเดือนของแพลตฯ หรือแก้มือ`,
      ],
      notes: [
        "ตัวเลขนี้คือรายได้จริง · ยอดขายแอพใช้คิดภาษีขายเท่านั้น",
        ...(transfer <= 0 ? [`ยังไม่มียอดโอน ${MONTH_CHANNEL_LABEL[k]} ของ${ctx.monthLabel} — นำเข้าที่หน้าแหล่งนำเข้า`] : []),
        ...(!canBreak && transfer > 0 ? ["ยังไม่มียอดขายแอพ จึงแตกส่วนหัก GP/อื่นๆ ไม่ได้"] : []),
      ],
      links: [LINK_SOURCES],
    };
  }

  if (id.startsWith("b.gp.")) {
    const k = id.slice(5) as MonthChannel;
    if (!MONTH_CHANNELS.includes(k)) return null;
    return {
      title: `GP ${MONTH_CHANNEL_LABEL[k]}`,
      result: n0(draft.gpFee[k]),
      formula: "ค่าบริการแพลตฯ (ไม่รวม VAT) ตามสรุปเดือน",
      terms: [{ label: `คชจ.GP ${MONTH_CHANNEL_SHORT[k]}`, amount: n0(draft.gpFee[k]) }],
      sources: [`คอลัมน์ คชจ.GP ของ ${MONTH_CHANNEL_LABEL[k]} ในตารางยอดเดลิเวอรี่`],
      notes: ["หักอยู่ในยอดโอนแล้ว — โชว์อ้างอิง ไม่หักกำไรซ้ำ", "ใช้คิดภาษีซื้อ GP ใน D"],
      links: [LINK_SOURCES],
    };
  }

  if (id.startsWith("d.gpVat.")) {
    const k = id.slice(8) as MonthChannel;
    if (!MONTH_CHANNELS.includes(k)) return null;
    return explainGpVatChannel(ctx, k);
  }

  switch (id) {
    case "a.delivery":
      return {
        title: "เดลิเวอรี่ (รวม)",
        result: view.deliveryTransfer,
        formula: "ยอดโอน ShopeeFood + Grab + LINE MAN",
        terms: channelTransferTerms(ctx),
        sources: ["ตาราง «ยอดเดลิเวอรี่» คอลัมน์ยอดโอน"],
        notes: ["ไม่ใช่ยอดขายแอพ — เป็นเงินที่ถึงร้านจริง"],
        links: [LINK_SOURCES],
      };
    case "a.storefront": {
      const posActive = ctx.sf.posConnected && ctx.sf.posCash + ctx.sf.posTransfer > 0;
      return {
        title: "หน้าร้าน",
        result: n0(draft.transfer.storefront),
        formula: posActive
          ? `(สด + พร้อมเพย์/โอน จาก nPOS) × ${ctx.sf.pct}%`
          : "ยอดที่ใส่มือ / ยอดต้นทาง × % จากแถบส่งหน้าร้าน",
        terms: posActive
          ? [
              { label: "nPOS เงินสด", amount: ctx.sf.posCash },
              { label: "nPOS พร้อมเพย์/โอน", amount: ctx.sf.posTransfer, op: "+" },
              { label: "รวมยอด nPOS", amount: r2(ctx.sf.posCash + ctx.sf.posTransfer), subtotal: true },
              { label: `ส่งเข้าตาราง ${ctx.sf.pct}%`, amount: null, op: "×" },
            ]
          : [{ label: "ยอดหน้าร้านในช่อง", amount: n0(draft.transfer.storefront) }],
        sources: [storefrontSource(ctx)],
        notes: [
          "หน้าร้านไม่มี GP — ยอดถึงร้าน = เงินรับจริง",
          "ยอดเดียวกันไปเป็นยอดขายหน้าร้านใน D (คิดภาษีขาย)",
          ...(ctx.sf.posConnected && !posActive
            ? ["ติ๊กดึง nPOS ไว้ แต่ยังไม่มียอดจาก nPOS เดือนนี้ — ตัวเลขในช่องมาจากที่ใส่ไว้"]
            : []),
          ...(posActive && ctx.sf.pct < 100
            ? [`ส่วนที่ไม่ได้ส่ง ${100 - ctx.sf.pct}% ไม่นับเป็นรายได้และไม่คิดภาษีขาย`]
            : []),
        ],
        links: [],
      };
    }
    case "a.income":
      return explainIncome(ctx, "รายได้สุทธิ (A)");
    case "b.gp":
      return {
        title: "GP แพลตฯ (อ้างอิง)",
        result: view.gpCostTotal,
        formula: "คชจ.GP ShopeeFood + Grab + LINE MAN",
        terms: MONTH_CHANNELS.map((k, i) => ({
          label: `คชจ.GP ${MONTH_CHANNEL_LABEL[k]}`,
          amount: n0(draft.gpFee[k]),
          op: i === 0 ? undefined : ("+" as const),
        })),
        sources: ["ตารางยอดเดลิเวอรี่ คอลัมน์ คชจ.GP"],
        notes: ["แพลตฯ หักจากยอดโอนแล้ว — ไม่หักกำไรซ้ำ", "ใช้เป็นฐานภาษีซื้อ GP ใน D"],
        links: [LINK_SOURCES],
      };
    case "b.books": {
      const staffOp = bookRowOp(ctx.staff);
      const ownerOp = bookRowOp(ctx.owner);
      return {
        title: "คชจ. สองบช. (หักกำไร)",
        result: view.booksOpex,
        formula: "บช.พนักงาน (ต้นทุน+คชจ.+อื่นๆ) + บช.เจ้าของ (ต้นทุน+คชจ.+อื่นๆ)",
        terms: [
          { label: "บช.พนักงาน", amount: staffOp },
          { label: "บช.เจ้าของ", amount: ownerOp, op: "+" },
        ],
        sources: [`รายการจ่ายทุกประเภทยกเว้นสินทรัพย์ ที่ลงวันที่ใน${ctx.monthLabel} — ผสานอัตโนมัติเมื่อเปิดหน้า`],
        notes: [CLAIM_RULE, ...periodNote(ctx), ...booksMissingNote(ctx)],
        links: [LINK_LEDGER, LINK_OWNER],
      };
    }
    case "b.books.staff":
    case "b.books.owner": {
      const isStaff = id === "b.books.staff";
      const row = isStaff ? ctx.staff : ctx.owner;
      const name = isStaff ? "บช.พนักงาน" : "บช.เจ้าของ";
      return {
        title: name,
        result: bookRowOp(row),
        formula: "ต้นทุน (cogs) + ค่าใช้จ่าย (sga) + อื่นๆ",
        terms: [
          { label: "ต้นทุน (cogs)", amount: row ? n0(row.cogs) : null },
          { label: "ค่าใช้จ่าย (sga)", amount: row ? n0(row.sga) : null, op: "+" },
          { label: "อื่นๆ", amount: row ? n0(row.other) : null, op: "+" },
        ],
        sources: [`${isStaff ? "บัญชีพนักงาน" : "บัญชีเจ้าของ"} — รายการจ่ายใน${ctx.monthLabel}`],
        notes: [CLAIM_RULE, ...periodNote(ctx)],
        links: [isStaff ? LINK_LEDGER : LINK_OWNER],
      };
    }
    case "b.asset": {
      const a = booksSumBy(ctx, "asset");
      return {
        title: "สินทรัพย์ (ไม่หัก)",
        result: a.total,
        formula: "สินทรัพย์ (asset) บช.พนักงาน + บช.เจ้าของ",
        terms: [
          { label: "บช.พนักงาน · สินทรัพย์", amount: a.staff },
          { label: "บช.เจ้าของ · สินทรัพย์", amount: a.owner, op: "+" },
        ],
        sources: [`รายการจ่ายประเภท «สินทรัพย์ (asset)» ใน${ctx.monthLabel}`],
        notes: ["ของใช้ระยะยาว (เครื่อง/อุปกรณ์) — โชว์อย่างเดียว ไม่หักกำไรเดือนนี้"],
        links: [LINK_LEDGER, LINK_OWNER],
      };
    }
    case "b.layer.claimed": {
      const c = booksSumBy(ctx, "cogs");
      return {
        title: "ต้นทุนขาย (cogs) สองบช.",
        result: c.total,
        formula: "ต้นทุน (cogs) ทั้งหมดของสองบช. — ที่ติ๊กหักภาษีซื้อนับ บิล − VAT · ที่ไม่ติ๊กนับบิลเต็ม",
        terms: [
          { label: "บช.พนักงาน", amount: c.staff },
          { label: "บช.เจ้าของ", amount: c.owner, op: "+" },
        ],
        sources: ["บัญชีพนักงาน + บัญชีเจ้าของ ประเภทต้นทุน"],
        notes: [
          "ยอดนี้รวมทั้งรายการที่ติ๊กและไม่ติ๊ก (= ต้นทุนขายใน C) — ไม่ได้มีแค่รายการที่ติ๊ก",
          CLAIM_RULE,
          ...periodNote(ctx),
        ],
        links: [LINK_LEDGER, LINK_OWNER],
      };
    }
    case "b.layer.vat": {
      const v = booksSumBy(ctx, "vatCogs");
      return {
        title: "VAT ที่ตัดออกจากต้นทุน",
        result: v.total,
        formula: "ภาษีซื้อของรายการต้นทุนที่ติ๊ก «หักภาษีซื้อ»",
        terms: [
          { label: "บช.พนักงาน", amount: v.staff },
          { label: "บช.เจ้าของ", amount: v.owner, op: "+" },
        ],
        sources: ["ช่อง VAT บนบิลของรายการต้นทุนที่ติ๊กหักภาษีซื้อ"],
        notes: ["ยอดนี้ไม่ปนในต้นทุน — ไปหักภาษีขายใน D"],
        links: [LINK_LEDGER, LINK_OWNER],
      };
    }
    case "b.layer.unclaimed":
      return {
        title: "รายการไม่ติ๊กหักภาษีซื้อ",
        result: null,
        formula: "ต้นทุน = ยอดบิลรวม VAT ทั้งก้อน",
        terms: [],
        sources: ["บัญชีพนักงาน + บัญชีเจ้าของ"],
        notes: [
          "รวมอยู่ในคชจ.สองบช. ด้านบนแล้ว — ไม่แยกยอด",
          `ติ๊กได้ในตาราง «ภาษีซื้อสองบช.» ใน D (ตอนนี้ติ๊ก ${ctx.claimedBooksCount}/${ctx.booksLineCount} รายการที่มี VAT บนบิล)`,
        ],
        links: [],
      };
    case "b.costTotal":
      return {
        title: "คชจ. ที่หักกำไร",
        result: view.costTotal,
        formula: "= คชจ. สองบช. (ไม่รวม GP · ไม่รวมสินทรัพย์)",
        terms: [{ label: "คชจ. สองบช.", amount: view.booksOpex }],
        sources: ["บัญชีพนักงาน + บัญชีเจ้าของ"],
        notes: ["GP อยู่ในยอดโอนแล้ว จึงไม่บวกเข้ามาอีก", ...periodNote(ctx)],
        links: [LINK_LEDGER, LINK_OWNER],
      };
    case "c.income":
      return explainIncome(ctx, "รายได้ถึงร้าน (ยอดโอน)");
    case "c.cogs":
      return explainCogs(ctx);
    case "c.grossProfit": {
      const cogs = ctx.staff && ctx.owner ? booksSumBy(ctx, "cogs").total : null;
      return {
        title: "กำไรขั้นต้น",
        result: cogs == null ? null : r2(view.incomeTotal - cogs),
        formula: "รายได้ถึงร้าน − ต้นทุนขาย",
        terms: [
          { label: "รายได้ถึงร้าน", amount: view.incomeTotal },
          { label: "ต้นทุนขาย", amount: cogs, op: "−" },
        ],
        sources: ["รายได้ ← A) · ต้นทุนขาย ← ประเภทต้นทุนในสองบช."],
        notes: ["แตะ «ต้นทุนขาย» เพื่อดูว่าต้นทุนมาจากบช.ไหนเท่าไร", ...booksMissingNote(ctx)],
        links: [],
      };
    }
    case "c.otherOpex":
      return explainOtherOpex(ctx);
    case "c.operatingProfit": {
      const cogs = ctx.staff && ctx.owner ? booksSumBy(ctx, "cogs").total : null;
      const other =
        cogs == null || view.booksOpex == null ? null : r2(view.booksOpex - cogs);
      return {
        title: "กำไรประมาณการเดือน",
        result: view.monthProfit,
        formula: "รายได้ถึงร้าน − ต้นทุนขาย − (คชจ.ขาย/บริหาร + อื่นๆ)",
        terms: [
          { label: "รายได้ถึงร้าน", amount: view.incomeTotal },
          { label: "ต้นทุนขาย", amount: cogs, op: "−" },
          { label: "คชจ.ขาย/บริหาร + อื่นๆ", amount: other, op: "−" },
        ],
        sources: ["A) รายได้ · B) คชจ.สองบช."],
        notes: [
          "ยังไม่หัก VAT",
          "ไม่หัก GP ซ้ำ (อยู่ในยอดโอนแล้ว)",
          "ไม่หักสินทรัพย์",
          ...(ctx.staff && ctx.owner
            ? []
            : ["ยังโหลดสองบช.ไม่เสร็จ — ระหว่างนี้ยอดนี้ยังไม่ได้หักคชจ. (เท่ากับรายได้ชั่วคราว)"]),
        ],
        links: [],
      };
    }
    case "c.netVat":
      return explainNetVat(ctx, "VAT สุทธิ");
    case "c.netProfit":
      return {
        title: "กำไรสุทธิ (หลังหัก VAT)",
        result: view.profitAfterVat,
        formula: "กำไรประมาณการเดือน − VAT สุทธิ",
        terms: [
          { label: "กำไรประมาณการเดือน", amount: view.monthProfit },
          {
            label: "VAT สุทธิ",
            amount: view.netVat,
            op: "−",
            hint: view.netVat < 0 ? "ติดลบ = ได้คืน → ลบค่าติดลบคือบวกกลับ" : undefined,
          },
        ],
        sources: ["C) แถวด้านบน · VAT สุทธิจาก D)"],
        notes: [
          "VAT สุทธิติดลบ (ได้คืน) จะทำให้กำไรสุทธิมากกว่ากำไรประมาณการ",
          ...(ctx.staff && ctx.owner ? [] : ["ยังโหลดสองบช.ไม่เสร็จ — ยอดนี้ยังไม่ได้หักคชจ."]),
        ],
        links: [],
      };
    case "d.salesDelivery":
      return {
        title: "ยอดขายเดลิเวอรี่ → ภาษีขาย",
        result: view.delivery.outputVat,
        formula: `ยอดขายแอพรวม VAT × ${pct}%`,
        terms: [
          ...MONTH_CHANNELS.map((k, i) => ({
            label: `ยอดขาย ${MONTH_CHANNEL_LABEL[k]}`,
            amount: n0(draft.sales[k]),
            op: i === 0 ? undefined : ("+" as const),
          })),
          { label: "รวมยอดขายรวม VAT", amount: view.delivery.reportedGross, subtotal: true },
          { label: `อัตราภาษีขาย ${pct}%`, amount: null, op: "×" as const },
        ],
        sources: ["ตารางยอดเดลิเวอรี่ คอลัมน์ยอดขายแอพ (ยอดที่แพลตฯ รายงาน)"],
        notes: [`สรรพากรคิด ยอดขายรวม × ${pct}% (ไม่ใช่ ×${pct}/${100 + pct})`],
        links: [LINK_SOURCES],
      };
    case "d.salesStorefront":
      return {
        title: "ยอดขายหน้าร้าน → ภาษีขาย",
        result: view.storefront.outputVat,
        formula: `(โอน + สด) × ${pct}%`,
        terms: [
          { label: "หน้าร้าน โอน", amount: n0(draft.sales.storefrontTransfer) },
          { label: "หน้าร้าน สด", amount: n0(draft.sales.storefrontCash), op: "+" },
          { label: "รวมยอดขายรวม VAT", amount: view.storefront.reportedGross, subtotal: true },
          { label: `อัตราภาษีขาย ${pct}%`, amount: null, op: "×" },
        ],
        sources: [storefrontSource(ctx)],
        notes: ["เติมอัตโนมัติจากแถบส่งหน้าร้าน (ยอดหลัง %)"],
        links: [],
      };
    case "d.salesTotal":
      return {
        title: "ภาษีขายรวม",
        result: view.outputVat,
        formula: `ยอดขายรวม VAT ${fmtPlain(view.salesTotal)} × ${pct}%`,
        terms: [
          { label: "ภาษีขาย เดลิเวอรี่", amount: view.delivery.outputVat },
          { label: "ภาษีขาย หน้าร้าน", amount: view.storefront.outputVat, op: "+" },
        ],
        sources: ["ยอดขายแอพ (เดลิเวอรี่) + ยอดขายหน้าร้าน"],
        notes: ["ภาษีขายคิดเสมอ ไม่ขึ้นกับการติ๊กภาษีซื้อ"],
        links: [],
      };
    case "d.gpVat":
      return {
        title: "ภาษีซื้อ GP (รวม)",
        result: view.inputGpVat,
        formula: "ภาษีซื้อ GP ShopeeFood + Grab + LINE MAN",
        terms: MONTH_CHANNELS.map((k, i) => ({
          label: `GP ${MONTH_CHANNEL_LABEL[k]}`,
          amount: view.gpVatByChannel[k],
          op: i === 0 ? undefined : ("+" as const),
          hint: n0(draft.gpVatOverride[k]) > 0 ? "ใบกำกับ" : "ประมาณ",
        })),
        sources: ["คอลัมน์ VAT-ซื้อ ในตารางยอดเดลิเวอรี่ · ว่าง = ประมาณจาก คชจ.GP"],
        notes: [`ประมาณ = คชจ.GP × ${pct}/${100 + pct}`],
        links: [LINK_SOURCES],
      };
    case "d.booksVat":
    case "d.booksVatApplied": {
      const boxVat = n0(draft.ingredientVat);
      const roundDiff = r2(boxVat - view.inputBooksVat);
      const applied = id === "d.booksVatApplied";
      return {
        title: applied ? "ภาษีซื้อสองบช. → หักจากภาษีขาย" : "ภาษีซื้อสองบช.",
        result: applied ? view.inputBooksVat : boxVat,
        formula: applied
          ? "ยอดในช่องภาษีซื้อสองบช. (ปัดลงเป็นสตางค์) = ยอดที่หักจากภาษีขายจริง"
          : "ผลรวม VAT บนบิลของรายการที่ติ๊ก «หักภาษีซื้อ» ในสองบช.",
        terms: applied
          ? [
              { label: "ยอดในช่องภาษีซื้อสองบช.", amount: boxVat },
              ...(roundDiff !== 0 ? [{ label: "ปัดเศษลง", amount: roundDiff, op: "−" as const }] : []),
            ]
          : [{ label: `รายการที่ติ๊ก ${ctx.claimedBooksCount} รายการ`, amount: boxVat }],
        sources: [
          `บัญชีพนักงาน + บัญชีเจ้าของ — รายการใน${ctx.monthLabel} ที่มี VAT บนบิล (${ctx.booksLineCount} รายการ)`,
        ],
        notes: [
          ...(Math.abs(r2(ctx.claimedBooksVat) - r2(boxVat)) >= 0.01
            ? [
                `⚠ ยอดในช่อง ${fmtPlain(boxVat)} ไม่ตรงกับผลรวมรายการที่ติ๊ก ${fmtPlain(ctx.claimedBooksVat)} — น่าจะแก้ตัวเลขในช่องเอง`,
              ]
            : []),
          ...(roundDiff !== 0
            ? [`ยอดที่หักจริงต่างจากช่อง ${fmtPlain(roundDiff)} จากการปัดลงสตางค์ของระบบ VAT`]
            : []),
          "กด + เพื่อดู/ติ๊กรายรายการ · แตะชื่อรายการเพื่อเปิดบิล",
          `ยอดซื้อ ภ.พ.30 = ภาษีซื้อ × 100/${pct} รายใบ (ไม่ใช่ยอดบิล)`,
          "ติ๊กแล้วต้นทุนในบช.ลดลงเท่า VAT · ห้ามบันทึกบิลเดียวกันซ้ำสองบช.",
        ],
        links: [LINK_LEDGER, LINK_OWNER],
      };
    }
    case "d.inputTotal":
      return {
        title: view.includeInputVat ? "รวมภาษีซื้อ (หักจากภาษีขาย)" : "รวมภาษีซื้อ (ยังไม่หัก)",
        result: view.inputVat,
        formula: "ภาษีซื้อ GP + ภาษีซื้อสองบช.",
        terms: [
          { label: "ภาษีซื้อ GP", amount: view.inputGpVat },
          { label: "ภาษีซื้อสองบช.", amount: view.inputBooksVat, op: "+" },
        ],
        sources: ["แถวด้านบนในตารางภาษีซื้อ"],
        notes: view.includeInputVat
          ? ["นำไปหักภาษีขาย → VAT สุทธิ"]
          : ["ปิดติ๊ก «นำภาษีซื้อมารวมหัก» อยู่ — คำนวณไว้โชว์ ยังไม่หัก"],
        links: [],
      };
    default:
      return null;
  }
}

/** ตรวจว่าตัวเลขที่ประกอบ (ไม่มี ×) รวมแล้วเท่าผลลัพธ์ — ใช้ในเทส */
export function termsSum(terms: CalcTerm[]): number | null {
  if (terms.some((t) => t.op === "×")) return null;
  let s = 0;
  for (const t of terms) {
    if (t.subtotal) continue;
    if (t.amount == null) return null;
    s += t.op === "−" ? -t.amount : t.amount;
  }
  return r2(s);
}

/** ผลรวมคั่นกลางทุกแถวต้องเท่าผลรวมแถวบวก/ลบก่อนหน้า — ใช้ในเทส */
export function subtotalsConsistent(terms: CalcTerm[]): boolean {
  let s = 0;
  for (const t of terms) {
    if (t.op === "×") continue;
    if (t.subtotal) {
      if (t.amount == null || r2(t.amount) !== r2(s)) return false;
      continue;
    }
    if (t.amount == null) return true;
    s += t.op === "−" ? -t.amount : t.amount;
  }
  return true;
}
