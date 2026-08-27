/**
 * Server-first loader สำหรับหน้างานพนักงาน — input เดียวกับเจ้าของ แล้วกรองฝั่ง client
 */
import type { Unsubscribe } from "firebase/firestore";
import {
  getBonusDeductionMonthFromServer,
  getBonusDeductionSettingsFromServer,
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
  listActiveEmployeesFromServer,
  resolveLinkedEmployee,
  type Employee,
} from "./employees";
import { mapFirestoreError } from "./firestore-errors";
import { fetchOtEntriesFromServer, subscribeOtEntries, type OtEntry } from "./ot";
import {
  fetchProdEntriesFromServer,
  listProdProducts,
  subscribeProdEntries,
  type ProdEntry,
  type ProdProduct,
} from "./production";
import {
  getRateScheduleFromServer,
  subscribeRateSchedule,
  type RateScheduleEntry,
} from "./rate-schedule";
import type {
  StaffBonusBundle,
  StaffProductionBundle,
  StaffWorkBundleError,
  StaffWorkLoadStatus,
} from "./staff-work-bundle";
import type { StaffMember } from "./types";
import { bangkokMonthRangeMs } from "./utils";
import { workEntryCreditsEmployee } from "./work-entry-mine";

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

/** หลัง login — cache roster + link ใน memory (ไม่บล็อก navigation) */
export async function prefetchStaffIdentity(staff: StaffMember): Promise<StaffIdentityPrefetch> {
  const employees = await listActiveEmployeesFromServer();
  const linked = resolveLinkedEmployee(employees, staff);
  if (linked) {
    try {
      await ensureStaffEmployeeLink(staff, linked);
    } catch {
      /* best-effort */
    }
  }
  identityPrefetch = { employees, linked, fetchedAt: Date.now() };
  return identityPrefetch;
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
  if (prefetched && Date.now() - prefetched.fetchedAt < 120_000) {
    employees = prefetched.employees;
    linked = prefetched.linked ?? resolveLinkedEmployee(employees, staff);
  } else {
    employees = await listActiveEmployeesFromServer();
    linked = resolveLinkedEmployee(employees, staff);
    if (linked) {
      try {
        await ensureStaffEmployeeLink(staff, linked);
      } catch {
        /* best-effort */
      }
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
      getBonusPersonalCloseFromServer(month, linked.id),
    ]);

    return {
      bundle: {
        linked,
        employees,
        rateSchedule: rateDoc.entries,
        deductionSettings,
        deductionMonth,
        otEntries,
        prodEntries,
        livePool,
        monthStatus,
        personalClose,
      },
    };
  } catch (err) {
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
  if (prefetched && Date.now() - prefetched.fetchedAt < 120_000) {
    workers = prefetched.employees;
    linked = prefetched.linked ?? resolveLinkedEmployee(workers, staff);
  } else {
    workers = await listActiveEmployeesFromServer();
    linked = resolveLinkedEmployee(workers, staff);
    if (linked) {
      try {
        await ensureStaffEmployeeLink(staff, linked);
      } catch {
        /* best-effort */
      }
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
