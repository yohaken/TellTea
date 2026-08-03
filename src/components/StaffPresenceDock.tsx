"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CircleDollarSign,
  Eye,
  EyeOff,
  IdCard,
  UserCog,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { previewFromMember } from "@/lib/perm-preview";
import {
  STAFF_PRESENCE_AGE_TICK_MS,
  buildStaffPresenceItems,
  findEmployeeForPresence,
  formatPresenceAge,
  formatPresenceLastLogin,
  subscribeEmployeesForPresence,
  subscribeStaffForPresence,
  type StaffPresenceItem,
} from "@/lib/staff-presence";
import type { Employee } from "@/lib/employees";
import type { StaffMember } from "@/lib/types";
import {
  StaffPersonalInfoModal,
} from "@/components/StaffPersonalInfoModal";
import { getStaffPersonal } from "@/lib/staff-personal";
import type { StaffPersonalData } from "@/lib/types";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

/**
 * ไอคอนลอยขวาบน — เจ้าของ · แตะแล้วเมนูด่วนต่อคน
 * รวม “ดูในมุมพนักงาน” ทั้งแอป (รวมโบนัส)
 */
export function StaffPresenceDock() {
  const router = useRouter();
  const {
    realStaff,
    isPermPreview,
    permPreview,
    permissionLevels,
    startPermPreview,
    stopPermPreview,
  } = useAuth();
  const isOwner = realStaff?.role === "owner";
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [menuStaffId, setMenuStaffId] = useState<string | null>(null);
  const [personalTarget, setPersonalTarget] = useState<StaffMember | null>(null);
  const [personal, setPersonal] = useState<StaffPersonalData | null>(null);
  const [personalLoading, setPersonalLoading] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    const unsubStaff = subscribeStaffForPresence(setMembers, (err) => {
      if (typeof console !== "undefined") console.warn("staff presence", err.message);
    });
    const unsubEmp = subscribeEmployeesForPresence(setEmployees, (err) => {
      if (typeof console !== "undefined") console.warn("staff presence employees", err.message);
    });

    const refreshNow = () => setNow(Date.now());
    refreshNow();

    let timer: number | null = null;
    const startTick = () => {
      if (timer != null) window.clearInterval(timer);
      timer = window.setInterval(refreshNow, STAFF_PRESENCE_AGE_TICK_MS);
    };
    const stopTick = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    const onVis = () => {
      if (document.visibilityState === "visible") {
        refreshNow();
        startTick();
      } else {
        stopTick();
      }
    };

    if (document.visibilityState === "visible") startTick();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", refreshNow);
    window.addEventListener("pageshow", refreshNow);

    return () => {
      unsubStaff();
      unsubEmp();
      stopTick();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", refreshNow);
      window.removeEventListener("pageshow", refreshNow);
    };
  }, [isOwner]);

  const items = useMemo(
    () => buildStaffPresenceItems(members, employees, now),
    [members, employees, now],
  );

  const menuMember = menuStaffId
    ? members.find((m) => m.id === menuStaffId) || null
    : null;
  const menuItem = menuStaffId
    ? items.find((i) => i.staffId === menuStaffId) || null
    : null;
  const previewingThis =
    !!isPermPreview &&
    !!permPreview?.memberId &&
    permPreview.memberId === menuStaffId;

  useBodyScrollLock(!!menuStaffId || !!personalTarget);

  if (!isOwner || items.length === 0) return null;

  function closeMenu() {
    setMenuStaffId(null);
  }

  function startViewAs(member: StaffMember, item: StaffPresenceItem) {
    const emp = findEmployeeForPresence(member, employees);
    startPermPreview(
      previewFromMember(
        member,
        item.fullName || item.label,
        permissionLevels,
        emp?.id,
      ),
    );
    closeMenu();
  }

  function openBonusAs(member: StaffMember, item: StaffPresenceItem) {
    const emp = findEmployeeForPresence(member, employees);
    startPermPreview(
      previewFromMember(
        member,
        item.fullName || item.label,
        permissionLevels,
        emp?.id,
      ),
    );
    closeMenu();
    router.push("/bonus/");
  }

  function openStaffManage(member: StaffMember) {
    if (isPermPreview) stopPermPreview();
    closeMenu();
    router.push(`/staff/?account=${encodeURIComponent(member.id)}`);
  }

  async function openPersonal(member: StaffMember) {
    closeMenu();
    setPersonalTarget(member);
    setPersonalLoading(true);
    try {
      setPersonal(await getStaffPersonal(member.id));
    } finally {
      setPersonalLoading(false);
    }
  }

  return (
    <>
      <div
        className={`staff-presence-dock${isPermPreview ? " is-previewing" : ""}`}
        aria-label="พนักงานทั้งหมด"
        title="แตะชื่อเพื่อเมนูด่วน"
      >
        <ul className="staff-presence-list">
          {items.map((item) => {
            const active =
              !!isPermPreview &&
              !!permPreview?.memberId &&
              permPreview.memberId === item.staffId;
            return (
              <PresenceChip
                key={item.staffId}
                item={item}
                now={now}
                active={active}
                onOpen={() => {
                  // แตะไอคอนคนที่กำลังดูอยู่ซ้ำ → ออกจากมุมมองทันที
                  if (active) {
                    stopPermPreview();
                    closeMenu();
                    return;
                  }
                  setMenuStaffId(item.staffId);
                }}
              />
            );
          })}
        </ul>
      </div>

      {menuMember && menuItem ? (
        <div
          className="staff-presence-menu-backdrop"
          role="presentation"
          onClick={closeMenu}
        >
          <div
            className="staff-presence-menu"
            role="dialog"
            aria-label={`เมนู ${menuItem.fullName}`}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="staff-presence-menu-head">
              <div>
                <p className="staff-presence-menu-kicker">พนักงาน</p>
                <h2 className="staff-presence-menu-title">{menuItem.fullName}</h2>
                <p className="muted staff-presence-menu-meta">
                  {menuItem.label}
                  {menuItem.lastSeenAt
                    ? ` · เข้า ${formatPresenceLastLogin(menuItem.lastSeenAt, now)} · ${formatPresenceAge(menuItem.lastSeenAt, now)}`
                    : " · ยังไม่เคยเข้า"}
                </p>
              </div>
              <button
                type="button"
                className="ghost-btn icon-btn staff-btn-sm"
                aria-label="ปิด"
                onClick={closeMenu}
              >
                <X size={16} />
              </button>
            </header>

            <ul className="staff-presence-menu-list">
              <li>
                <button
                  type="button"
                  className="staff-presence-menu-item is-primary"
                  onClick={() => startViewAs(menuMember, menuItem)}
                >
                  <Eye size={16} aria-hidden />
                  <span>
                    <strong>ดูในมุมพนักงานคนนี้</strong>
                    <em>แท็บ · โบนัส · อื่นๆ ตามสิทธิ์เขาทันที</em>
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="staff-presence-menu-item"
                  onClick={() => openBonusAs(menuMember, menuItem)}
                >
                  <CircleDollarSign size={16} aria-hidden />
                  <span>
                    <strong>จ่าย / โบนัส ของคนนี้</strong>
                    <em>เปิดหน้าจ่ายในมุมเขา</em>
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="staff-presence-menu-item"
                  onClick={() => openStaffManage(menuMember)}
                >
                  <UserCog size={16} aria-hidden />
                  <span>
                    <strong>จัดการบัญชี / สิทธิ์</strong>
                    <em>ศูนย์พนักงาน · แก้ลำดับสิทธิ์</em>
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="staff-presence-menu-item"
                  disabled={personalLoading}
                  onClick={() => void openPersonal(menuMember)}
                >
                  <IdCard size={16} aria-hidden />
                  <span>
                    <strong>ข้อมูลส่วนตัว / บัตร</strong>
                    <em>ชื่อจริง · รูปบัตร (เจ้าของ)</em>
                  </span>
                </button>
              </li>
              {previewingThis ? (
                <li>
                  <button
                    type="button"
                    className="staff-presence-menu-item is-exit"
                    onClick={() => {
                      stopPermPreview();
                      closeMenu();
                    }}
                  >
                    <EyeOff size={16} aria-hidden />
                    <span>
                      <strong>ออกจากมุมมองนี้</strong>
                      <em>กลับมุมเจ้าของ</em>
                    </span>
                  </button>
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      ) : null}

      {personalTarget ? (
        <StaffPersonalInfoModal
          member={personalTarget}
          personal={personal}
          onClose={() => {
            setPersonalTarget(null);
            setPersonal(null);
          }}
        />
      ) : null}
    </>
  );
}

function PresenceChip({
  item,
  now,
  active,
  onOpen,
}: {
  item: StaffPresenceItem;
  now: number;
  active: boolean;
  onOpen: () => void;
}) {
  const age = formatPresenceAge(item.lastSeenAt, now);
  const hasSeen = item.lastSeenAt > 0;
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <li>
      <button
        ref={btnRef}
        type="button"
        className={`staff-presence-chip${item.online ? " is-online" : ""}${
          !hasSeen ? " is-waiting" : ""
        }${active ? " is-preview-active" : ""}`}
        title={
          active
            ? `กำลังดูมุม ${item.fullName} — แตะอีกครั้งเพื่อออก`
            : hasSeen
              ? `${item.fullName} · เข้า ${formatPresenceLastLogin(item.lastSeenAt, now)} (${age})`
              : `${item.fullName} · ยังไม่เคยเข้า`
        }
        aria-label={
          active
            ? `${item.fullName} กำลังดูมุม — แตะเพื่อออก`
            : item.fullName
        }
        onClick={onOpen}
      >
        <span className="staff-presence-name">{item.label}</span>
        <span className="staff-presence-age">{active ? "ออก" : age}</span>
      </button>
    </li>
  );
}
