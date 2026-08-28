/**
 * Server-first loader สำหรับหน้างานพนักงาน — input เดียวกับเจ้าของ แล้วกรองฝั่ง client
 */
import type { Unsubscribe } from "firebase/firestore";
import {
  getBonusDeductionMonthFromServer,
  getBonusDeductionSettingsFromServer,
  normalizeBonusDeductionMonthDoc,
  subscribeBonusDeductionMonth,
  subscribeBonusDeductionSettings,
} from "./bonus-deductions";
import {
  getBonusLivePoolFromServer,
  subscribeBonusLivePool,
  type BonusLivePool,
} from "./bonus-live-pool";
import {
  getBonusMonthStatusFromServer,
  getBonusPersonalCloseFromServer,
  subscribeBonusMonthStatus,
  subscribeBonusPersonalClose,
  type BonusMonthStatusDoc,
  type BonusPersonalCloseDoc,
} from "./bonus-personal-close";
import {
  ensureStaffEmployeeLink,
  fetchLinkedEmployeeFromServer,
  listActiveEmployeesForStaff,
  resolveLinkedEmployee,
  type Employee,
} from "./employees";
import { mapFirestoreError } from "./firestore-errors";
import { getFirebaseFunctions } from "./firebase";
import { httpsCallable } from "firebase/functions";
import { fetchOtEntriesFromServer, mapOtEntryDoc, subscribeOtEntries, type OtEntry } from "./ot";
import type { ProdEntry, ProdProduct } from "./production";
import {
  fetchProdEntriesFromServer,
  listProdProducts,
  mapProdEntryDoc,
  subscribeProdEntries,
} from "./production";
import {
  getRateScheduleFromServer,
  subscribeRateSchedule,
  type RateScheduleEntry,
} from "./rate-schedule";
import type {
  BonusDeductionMonthDoc,
  BonusDeductionSettings,
} from "./bonus-deductions";
import type {
  StaffBonusBundle,
  StaffProductionBundle,
  StaffWorkBundleError,
  StaffWorkLoadStatus,
} from "./staff-work-bundle";
import type { StaffMember } from "./types";
import { bangkokMonthRangeMs } from "./utils";
import { workEntryCreditsEmployee } from "./work-entry-mine";

type CallableBonusBundleRaw = {
  linked: Employee;
  employees: Employee[];
  rateSchedule: RateScheduleEntry[];
  deductionSettings: BonusDeductionSettings | null;
  deductionMonth: BonusDeductionMonthDoc | null;
  otEntries: Array<{ id: string } & Record<string, unknown>>;
  prodEntries: Array<{ id: string } & Record<string, unknown>>;
  livePool: BonusLivePool | null;
  monthStatus: BonusMonthStatusDoc | null;
  personalClose: BonusPersonalCloseDoc | null;
};

async function loadStaffBonusBundleViaCallable(month: string): Promise<StaffBonusBundle> {
  const fn = httpsCallable<{ month: string }, { ok?: boolean; bundle?: CallableBonusBundleRaw }>(
    getFirebaseFunctions(),
    "loadStaffBonusBundle",
  );
  const res = await fn({ month });
  const raw = res.data?.bundle;
  if (!res.data?.ok || !raw?.linked || !raw.deductionSettings) {
    throw new Error("โหลดสรุปโบนัสไม่สำเร็จ");
  }
  return {
    linked: raw.linked,
    employees: raw.employees,
    rateSchedule: raw.rateSchedule,
    deductionSettings: raw.deductionSettings,
    deductionMonth: raw.deductionMonth
      ? normalizeBonusDeductionMonthDoc(
          Number(month.slice(0, 4)),
          Number(month.slice(5, 7)),
          raw.deductionMonth,
        )
      : normalizeBonusDeductionMonthDoc(
          Number(month.slice(0, 4)),
          Number(month.slice(5, 7)),
          undefined,
        ),
    otEntries: raw.otEntries.map((row) => mapOtEntryDoc(row.id, row)),
    prodEntries: raw.prodEntries.map((row) => mapProdEntryDoc(row.id, row)),
    livePool: raw.livePool,
    monthStatus: raw.monthStatus,
    personalClose: raw.personalClose,
  };
}

async function loadStaffProductionBundleViaCallable(
  year: number,
  monthIdx: number,
): Promise<StaffProductionBundle> {
  const fn = httpsCallable<
    { year: number; monthIdx: number },
    {
      ok?: boolean;
      bundle?: {
        linked: Employee;
        workers: Employee[];
        products: Array<{ id: string } & Record<string, unknown>>;
        rateSchedule: RateScheduleEntry[];
        prodEntries: Array<{ id: string } & Record<string, unknown>>;
      };
    }
  >(getFirebaseFunctions(), "loadStaffProductionBundle");
  const res = await fn({ year, monthIdx });
  const raw = res.data?.bundle;
  if (!res.data?.ok || !raw?.linked) {
    throw new Error("โหลดรายการผลิตไม่สำเร็จ");
  }
  return {
    linked: raw.linked,
    workers: raw.workers,
    products: raw.products.map((row) => ({
      id: row.id,
      ...(row as unknown as Omit<ProdProduct, "id">),
    })),
    rateSchedule: raw.rateSchedule,
    entries: raw.prodEntries.map((row) => mapProdEntryDoc(row.id, row)),
  };
}

export function classifyStaffWorkError(err: unknown, source?: string): StaffWorkBundleError {
  const code = (err as { code?: string })?.code || "";
  const msg = err instanceof Error ? err.message : String(err);
  if (code === "permission-denied" || /insufficient permissions|permission-denied/i.test(msg)) {
    return {
      status: "blocked_perm",
      message: mapFirestoreError(err, source || "โหลดข้อมูล"),
      source,
    };
  }
  if (
    code === "unavailable" ||
    /network|timeout|failed to get document/i.test(msg)
  ) {
    return {
      status: "blocked_network",
      message: mapFirestoreError(err, source || "โหลดข้อมูล"),
      source,
    };
  }
  return {
    status: "blocked_network",
    message: mapFirestoreError(err, source || "โหลดข้อมูล"),
    source,
  };
}

export type StaffIdentityPrefetch = {
  employees: Employee[];
  linked: Employee | null;
  fetchedAt: number;
};

let identityPrefetch: StaffIdentityPrefetch | null = null;

export function getStaffIdentityPrefetch(): StaffIdentityPrefetch | null {
  return identityPrefetch;
}

export function clearStaffIdentityPrefetch() {
  identityPrefetch = null;
}

async function resolveStaffLinkedEmployee(
  staff: StaffMember,
  employees: Employee[],
): Promise<{ employees: Employee[]; linked: Employee | null }> {
  let linked = resolveLinkedEmployee(employees, staff);
  if (!linked) {
    const fetched = await fetchLinkedEmployeeFromServer(staff);
    if (fetched) {
      linked = fetched;
      if (!employees.some((e) => e.id === fetched.id)) {
        employees = [...employees, fetched];
      }
    }
  }
  if (linked) {
    try {
      await ensureStaffEmployeeLink(staff, linked);
    } catch {
      /* best-effort */
    }
  }
  return { employees, linked };
}

function isIdentityPrefetchFresh(prefetched: StaffIdentityPrefetch | null): boolean {
  return (
    prefetched != null &&
    prefetched.linked != null &&
    Date.now() - prefetched.fetchedAt < 120_000
  );
}

/** หลัง login — cache roster + link ใน memory (ไม่บล็อก navigation) */
export async function prefetchStaffIdentity(staff: StaffMember): Promise<StaffIdentityPrefetch> {
  let employees = await listActiveEmployeesForStaff(staff);
  const { employees: nextEmps, linked } = await resolveStaffLinkedEmployee(staff, employees);
  employees = nextEmps;
  const snapshot: StaffIdentityPrefetch = { employees, linked, fetchedAt: Date.now() };
  // อย่า cache ล้มเหลว — token/rules ยังไม่พร้อมตอน login ทำให้ค้าง "ไม่ผูกชื่อ" 120s
  identityPrefetch = linked ? snapshot : null;
  return snapshot;
}

export async function loadStaffBonusBundleFromServer(
  staff: StaffMember,
  month: string,
  year: number,
  monthIdx: number,
): Promise<{ bundle: StaffBonusBundle } | { error: StaffWorkBundleError }> {
  const prefetched = identityPrefetch;
  let employees: Employee[];
  let linked: Employee | null;
  if (isIdentityPrefetchFresh(prefetched)) {
    employees = prefetched!.employees;
    linked = prefetched!.linked;
  } else {
    employees = await listActiveEmployeesForStaff(staff);
    ({ employees, linked } = await resolveStaffLinkedEmployee(staff, employees));
    if (linked) {
      identityPrefetch = { employees, linked, fetchedAt: Date.now() };
    }
  }

  if (!linked) {
    return {
      error: {
        status: "blocked_link",
        message: "บัญชียังไม่ผูกกับรายชื่อร้าน — ไปโปรไฟล์เพื่อเชื่อมชื่อ",
      },
    };
  }

  const { since, until } = bangkokMonthRangeMs(year, monthIdx);

  async function fetchBundle() {
    const [
      rateDoc,
      deductionSettings,
      deductionMonth,
      otEntries,
      prodEntries,
      livePool,
      monthStatus,
      personalClose,
    ] = await Promise.all([
      getRateScheduleFromServer(),
      getBonusDeductionSettingsFromServer(),
      getBonusDeductionMonthFromServer(year, monthIdx),
      fetchOtEntriesFromServer({ since, until }),
      fetchProdEntriesFromServer({ since, until }),
      getBonusLivePoolFromServer(month),
      getBonusMonthStatusFromServer(month),
      getBonusPersonalCloseFromServer(month, linked!.id),
    ]);
    return {
      linked: linked!,
      employees,
      rateSchedule: rateDoc.entries,
      deductionSettings,
      deductionMonth,
      otEntries,
      prodEntries,
      livePool,
      monthStatus,
      personalClose,
    };
  }

  try {
    return { bundle: await loadStaffBonusBundleViaCallable(month) };
  } catch (callableErr) {
    const callableCode = (callableErr as { code?: string })?.code || "";
    const callableMsg = (callableErr as Error)?.message || "";
    const callableMissing =
      callableCode === "functions/not-found" ||
      /not-found|404|UNIMPLEMENTED/i.test(callableMsg);
    if (!callableMissing) {
      const permLike =
        callableCode === "functions/permission-denied" ||
        /permission|สิทธิ์/i.test(callableMsg);
      if (permLike) {
        return { error: classifyStaffWorkError(callableErr, "โหลดสรุปโบนัส") };
      }
    }
  }

  try {
    return { bundle: await fetchBundle() };
  } catch (err) {
    const code = (err as { code?: string })?.code || "";
    const msg = (err as Error)?.message || "";
    if (code === "permission-denied" || /insufficient permissions/i.test(msg)) {
      try {
        const { getFirebaseAuth } = await import("./firebase");
        await getFirebaseAuth().currentUser?.getIdToken(true);
        return { bundle: await fetchBundle() };
      } catch (retryErr) {
        try {
          return { bundle: await loadStaffBonusBundleViaCallable(month) };
        } catch (callableErr) {
          return { error: classifyStaffWorkError(callableErr, "โหลดสรุปโบนัส") };
        }
      }
    }
    return { error: classifyStaffWorkError(err, "โหลดสรุปโบนัส") };
  }
}

export function subscribeStaffBonusBundleLive(
  staff: StaffMember,
  month: string,
  year: number,
  monthIdx: number,
  linked: Employee,
  onPatch: (patch: Partial<StaffBonusBundle>) => void,
  onError?: (err: StaffWorkBundleError) => void,
): Unsubscribe {
  const { since, until } = bangkokMonthRangeMs(year, monthIdx);
  const unsubs: Unsubscribe[] = [];

  unsubs.push(
    subscribeRateSchedule(
      (doc) => onPatch({ rateSchedule: doc.entries }),
      (err) => onError?.(classifyStaffWorkError(err, "ตารางเรท")),
    ),
  );
  unsubs.push(
    subscribeBonusDeductionSettings(
      (deductionSettings) => onPatch({ deductionSettings }),
      (err) => onError?.(classifyStaffWorkError(err, "กติกาหักโบนัส")),
    ),
  );
  unsubs.push(
    subscribeBonusDeductionMonth(
      year,
      monthIdx,
      (deductionMonth) => onPatch({ deductionMonth }),
      (err) => onError?.(classifyStaffWorkError(err, "หักโบนัสเดือน")),
    ),
  );
  unsubs.push(
    subscribeOtEntries(
      (otEntries) => onPatch({ otEntries }),
      (err) => onError?.(classifyStaffWorkError(err, "รายการชง")),
      { since, until, ignoreCacheSnapshots: true },
    ),
  );
  unsubs.push(
    subscribeProdEntries(
      (prodEntries) => onPatch({ prodEntries }),
      (err) => onError?.(classifyStaffWorkError(err, "รายการผลิต")),
      { since, until, ignoreCacheSnapshots: true },
    ),
  );
  unsubs.push(
    subscribeBonusLivePool(
      month,
      (livePool) => onPatch({ livePool }),
      (err) => onError?.(classifyStaffWorkError(err, "พูลโบนัส")),
    ),
  );
  unsubs.push(
    subscribeBonusMonthStatus(
      month,
      (monthStatus) => onPatch({ monthStatus }),
      (err) => onError?.(classifyStaffWorkError(err, "สถานะเดือน")),
    ),
  );
  unsubs.push(
    subscribeBonusPersonalClose(
      month,
      linked.id,
      (personalClose) => onPatch({ personalClose }),
      (err) => onError?.(classifyStaffWorkError(err, "สรุปโบนัสส่วนตัว")),
    ),
  );

  return () => {
    for (const u of unsubs) u();
  };
}

export async function loadStaffProductionBundleFromServer(
  staff: StaffMember,
  year: number,
  monthIdx: number,
): Promise<{ bundle: StaffProductionBundle } | { error: StaffWorkBundleError }> {
  const prefetched = identityPrefetch;
  let workers: Employee[];
  let linked: Employee | null;
  if (isIdentityPrefetchFresh(prefetched)) {
    workers = prefetched!.employees;
    linked = prefetched!.linked;
  } else {
    workers = await listActiveEmployeesForStaff(staff);
    ({ employees: workers, linked } = await resolveStaffLinkedEmployee(staff, workers));
    if (linked) {
      identityPrefetch = { employees: workers, linked, fetchedAt: Date.now() };
    }
  }

  if (!linked) {
    return {
      error: {
        status: "blocked_link",
        message: "บัญชียังไม่ผูกกับรายชื่อร้าน — ไปโปรไฟล์เพื่อเชื่อมชื่อ",
      },
    };
  }

  const { since, until } = bangkokMonthRangeMs(year, monthIdx);

  try {
    const viaCallable = await loadStaffProductionBundleViaCallable(year, monthIdx);
    const entries = viaCallable.entries.filter((r) =>
      workEntryCreditsEmployee(r, viaCallable.linked, viaCallable.workers, staff.id),
    );
    return { bundle: { ...viaCallable, entries } };
  } catch (callableErr) {
    const code = (callableErr as { code?: string })?.code || "";
    const msg = (callableErr as Error)?.message || "";
    const callableMissing =
      code === "functions/not-found" || /not-found|404|UNIMPLEMENTED/i.test(msg);
    if (!callableMissing) {
      const permLike =
        code === "functions/permission-denied" ||
        /permission|สิทธิ์/i.test(msg);
      if (permLike) {
        return { error: classifyStaffWorkError(callableErr, "โหลดรายการผลิต") };
      }
    }
  }

  try {
    const [products, rateDoc, prodEntries] = await Promise.all([
      listProdProducts(),
      getRateScheduleFromServer(),
      fetchProdEntriesFromServer({ since, until }),
    ]);
    const entries = prodEntries.filter((r) =>
      workEntryCreditsEmployee(r, linked, workers, staff.id),
    );
    return {
      bundle: {
        linked,
        workers,
        products,
        rateSchedule: rateDoc.entries,
        entries,
      },
    };
  } catch (err) {
    return { error: classifyStaffWorkError(err, "โหลดรายการผลิต") };
  }
}

export function subscribeStaffProductionBundleLive(
  staff: StaffMember,
  year: number,
  monthIdx: number,
  linked: Employee,
  workers: Employee[],
  onPatch: (patch: Partial<StaffProductionBundle>) => void,
  onError?: (err: StaffWorkBundleError) => void,
): Unsubscribe {
  const { since, until } = bangkokMonthRangeMs(year, monthIdx);
  const unsubs: Unsubscribe[] = [];

  unsubs.push(
    subscribeRateSchedule(
      (doc) => onPatch({ rateSchedule: doc.entries }),
      (err) => onError?.(classifyStaffWorkError(err, "ตารางเรท")),
    ),
  );
  unsubs.push(
    subscribeProdEntries(
      (rows) => {
        onPatch({
          entries: rows.filter((r) =>
            workEntryCreditsEmployee(r, linked, workers, staff.id),
          ),
        });
      },
      (err) => onError?.(classifyStaffWorkError(err, "รายการผลิต")),
      { since, until, ignoreCacheSnapshots: true },
    ),
  );

  return () => {
    for (const u of unsubs) u();
  };
}
