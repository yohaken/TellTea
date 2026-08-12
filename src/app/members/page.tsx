"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { mapFirestoreError } from "@/lib/firestore-errors";
import { PosConfirmDialog } from "@/components/PosConfirmDialog";
import {
  adjustMemberPoints,
  createMember,
  deleteMember,
  filterMembers,
  getCompCouponDailyUsage,
  getMemberSettings,
  listMemberLedger,
  listMembers,
  MEMBER_LEDGER_REASON_LABELS,
  MEMBER_SOURCE_LABELS,
  saveMemberSettings,
  updateMember,
  type MemberLedgerEntry,
  type MemberSettings,
  type ShopMember,
} from "@/lib/members";
import { can, canAccessMembersHub } from "@/lib/permissions";
import {
  claimQrDataUrl,
  issueReceiptClaimForSale,
  type ReceiptClaimIssue,
} from "@/lib/receipt-claim";
import { subscribePosSalesToday } from "@/lib/pos-sales-admin";
import type { PosSale } from "@/lib/types";
import { formatPhoneDisplay } from "@/lib/utils";

type TabKey = "list" | "claim" | "settings";

export default function MembersPage() {
  return (
    <AuthGate>
      <MembersView />
    </AuthGate>
  );
}

function formatWhen(ms: number) {
  if (!ms) return "—";
  const d = new Date(ms);
  const dd = d.getDate();
  const mm = d.getMonth() + 1;
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
}

function phoneLabel(m: ShopMember) {
  try {
    return formatPhoneDisplay(m.phone);
  } catch {
    return m.phone || m.phoneDigits;
  }
}

function MembersView() {
  const { staff, actorId } = useAuth();
  const router = useRouter();
  const canHub = canAccessMembersHub(staff);
  const canManage = can(staff, "membersManage");
  const canAdjust = can(staff, "membersAdjustPoints") || canManage;

  const [tab, setTab] = useState<TabKey>("list");
  const [members, setMembers] = useState<ShopMember[]>([]);
  const [settings, setSettings] = useState<MemberSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());

  const [showAdd, setShowAdd] = useState(false);
  const [addPhone, setAddPhone] = useState("");
  const [addName, setAddName] = useState("");
  const [saving, setSaving] = useState(false);

  const [selected, setSelected] = useState<ShopMember | null>(null);
  const [editName, setEditName] = useState("");
  const [editNote, setEditNote] = useState("");
  const [ledger, setLedger] = useState<MemberLedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [pointsDelta, setPointsDelta] = useState("");
  const [pointsNote, setPointsNote] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const [setEnabled, setSetEnabled] = useState(false);
  const [setBaht, setSetBaht] = useState("25");
  const [setRedeem, setSetRedeem] = useState("1");
  const [setBonus, setSetBonus] = useState("0");
  const [setPublic, setSetPublic] = useState(false);
  const [setReceiptClaim, setSetReceiptClaim] = useState(false);
  const [setClaimTtl, setSetClaimTtl] = useState("30");
  const [setCompCoupon, setSetCompCoupon] = useState(false);
  const [setCompQuota, setSetCompQuota] = useState("200");
  const [compIssuedToday, setCompIssuedToday] = useState(0);

  const [todaySales, setTodaySales] = useState<PosSale[]>([]);
  const [claimSaleId, setClaimSaleId] = useState("");
  const [claimIssue, setClaimIssue] = useState<ReceiptClaimIssue | null>(null);
  const [claimQr, setClaimQr] = useState<string | null>(null);
  const claimQrPanelRef = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async () => {
    if (!canHub) return;
    setLoading(true);
    setError(null);
    try {
      const [list, cfg, daily] = await Promise.all([
        listMembers(),
        getMemberSettings(),
        getCompCouponDailyUsage(),
      ]);
      setMembers(list);
      setSettings(cfg);
      setSetEnabled(cfg.enabled);
      setSetBaht(String(cfg.bahtPerPoint));
      setSetRedeem(String(cfg.pointsPerBahtRedeem));
      setSetBonus(String(cfg.signupBonusPoints));
      setSetPublic(cfg.publicSignupEnabled);
      setSetReceiptClaim(cfg.receiptClaimEnabled);
      setSetClaimTtl(String(cfg.claimTokenTtlDays));
      setSetCompCoupon(cfg.compCouponEnabled);
      setSetCompQuota(String(cfg.compCouponDailyQuota));
      setCompIssuedToday(daily.issued);
      setSelected((prev) => {
        if (!prev) return null;
        return list.find((m) => m.id === prev.id) || null;
      });
    } catch (err) {
      setError(mapFirestoreError(err, "โหลดสมาชิก"));
    } finally {
      setLoading(false);
    }
  }, [canHub]);

  useEffect(() => {
    if (staff && !canHub) router.replace("/ledger/");
  }, [staff, canHub, router]);

  useEffect(() => {
    if (!canHub) return;
    void reload();
  }, [canHub, reload]);

  useEffect(() => {
    if (!selected) {
      setLedger([]);
      return;
    }
    setEditName(selected.displayName);
    setEditNote(selected.note);
    let cancelled = false;
    setLedgerLoading(true);
    void listMemberLedger(selected.id)
      .then((rows) => {
        if (!cancelled) setLedger(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(mapFirestoreError(err, "โหลดประวัติแต้ม"));
      })
      .finally(() => {
        if (!cancelled) setLedgerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  useEffect(() => {
    if (!canHub || tab !== "claim") return;
    return subscribePosSalesToday(
      (sales) => setTodaySales(sales.filter((s) => s.status !== "voided")),
      (err) => setError(err.message || "โหลดบิลวันนี้ไม่สำเร็จ"),
    );
  }, [canHub, tab]);

  const filtered = useMemo(
    () => filterMembers(members, deferredQuery),
    [members, deferredQuery],
  );

  if (!canHub) return null;

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!canManage || !actorId) return;
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const created = await createMember(
        { phone: addPhone, displayName: addName, source: "staff_boh" },
        actorId,
      );
      setShowAdd(false);
      setAddPhone("");
      setAddName("");
      setMsg(`สมัครแล้ว · ${created.displayName}`);
      await reload();
      setSelected(created);
    } catch (err) {
      setError(mapFirestoreError(err, "สมัครสมาชิก"));
    } finally {
      setSaving(false);
    }
  }

  async function onSaveProfile(e: FormEvent) {
    e.preventDefault();
    if (!canManage || !actorId || !selected) return;
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const next = await updateMember(
        selected.id,
        { displayName: editName, note: editNote },
        actorId,
      );
      setSelected(next);
      setMsg("บันทึกแล้ว");
      await reload();
    } catch (err) {
      setError(mapFirestoreError(err, "บันทึกโปรไฟล์"));
    } finally {
      setSaving(false);
    }
  }

  async function onToggleStatus() {
    if (!canManage || !actorId || !selected) return;
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const nextStatus = selected.status === "active" ? "suspended" : "active";
      const next = await updateMember(selected.id, { status: nextStatus }, actorId);
      setSelected(next);
      setMsg(nextStatus === "active" ? "เปิดใช้แล้ว" : "ระงับแล้ว");
      await reload();
    } catch (err) {
      setError(mapFirestoreError(err, "เปลี่ยนสถานะ"));
    } finally {
      setSaving(false);
    }
  }

  async function onConfirmDeleteMember() {
    if (!canManage || !actorId || !selected) return;
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const name = selected.displayName;
      await deleteMember(selected.id, actorId);
      setConfirmDeleteOpen(false);
      setSelected(null);
      setMsg(`ลบสมาชิกแล้ว · ${name}`);
      await reload();
    } catch (err) {
      setError(mapFirestoreError(err, "ลบสมาชิก"));
    } finally {
      setSaving(false);
    }
  }

  async function onAdjustPoints(e: FormEvent) {
    e.preventDefault();
    if (!canAdjust || !actorId || !selected) return;
    const delta = Math.trunc(Number(pointsDelta));
    if (!Number.isFinite(delta) || !delta) {
      setError("ใส่จำนวนแต้มที่ไม่เป็นศูนย์");
      return;
    }
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const next = await adjustMemberPoints(
        { memberId: selected.id, delta, reason: "adjust", note: pointsNote },
        actorId,
      );
      setSelected(next);
      setPointsDelta("");
      setPointsNote("");
      setMsg(`แต้ม ${next.pointsBalance}`);
      setLedger(await listMemberLedger(next.id));
      await reload();
    } catch (err) {
      setError(mapFirestoreError(err, "ปรับแต้ม"));
    } finally {
      setSaving(false);
    }
  }

  async function onSaveSettings(e: FormEvent) {
    e.preventDefault();
    if (!canManage || !actorId) return;
    const baht = Number(setBaht);
    const redeem = Number(setRedeem);
    const bonus = Number(setBonus);
    const claimTtl = Number(setClaimTtl);
    const compQuota = Number(setCompQuota);
    if (!(baht > 0) || !(redeem > 0) || !(bonus >= 0) || !Number.isFinite(bonus)) {
      setError("ค่าตั้งค่าไม่ถูกต้อง");
      return;
    }
    if (!(claimTtl >= 1) || claimTtl > 365 || !Number.isFinite(claimTtl)) {
      setError("อายุลิงก์ 1–365 วัน");
      return;
    }
    if (
      !Number.isFinite(compQuota) ||
      compQuota < 0 ||
      compQuota > 10000 ||
      (setCompCoupon && !(compQuota > 0))
    ) {
      setError("โควต้า QR ให้แต้ม 1–10000 ต่อวัน (เมื่อเปิดใช้)");
      return;
    }
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const next = await saveMemberSettings(
        {
          enabled: setEnabled,
          bahtPerPoint: baht,
          pointsPerBahtRedeem: redeem,
          signupBonusPoints: Math.floor(bonus),
          publicSignupEnabled: setPublic,
          receiptClaimEnabled: setReceiptClaim,
          claimTokenTtlDays: Math.floor(claimTtl),
          compCouponEnabled: setCompCoupon,
          compCouponPointsPerSlip: 1,
          compCouponDailyQuota: Math.floor(compQuota),
        },
        actorId,
      );
      setSettings(next);
      const daily = await getCompCouponDailyUsage();
      setCompIssuedToday(daily.issued);
      setMsg("บันทึกแล้ว");
    } catch (err) {
      setError(mapFirestoreError(err, "บันทึกตั้งค่า"));
    } finally {
      setSaving(false);
    }
  }

  async function onIssueClaim(saleId: string, forceNew = false) {
    if (!canManage || !actorId) return;
    const id = saleId.trim();
    if (!id) {
      setError("ใส่รหัสบิลหรือเลือกจากรายการ");
      return;
    }
    setSaving(true);
    setError(null);
    setMsg(null);
    setClaimIssue(null);
    setClaimQr(null);
    try {
      const issued = await issueReceiptClaimForSale(id, actorId, { forceNewToken: forceNew });
      setClaimSaleId(issued.saleId);
      setClaimIssue(issued);
      setClaimQr(await claimQrDataUrl(issued.claimUrl));
      const tag = forceNew
        ? "โทเคนใหม่"
        : issued.claimed
          ? "QR เดิม (เคลมแล้ว)"
          : issued.reused
            ? "โทเคนเดิม"
            : "ออกใหม่";
      setMsg(`บิล ${issued.billNo} · ~${issued.pointsPreview} แต้ม · ${tag}`);
      // ปุ่มในตารางอยู่ล่าง — เลื่อนขึ้นให้เห็น QR ชัด
      requestAnimationFrame(() => {
        claimQrPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (err) {
      setError(mapFirestoreError(err, "ออก QR เคลม"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="staff-hub members-hub members-hub--slim">
      <header className="staff-hub-head members-slim-head">
        <h1 className="staff-hub-title">
          สมาชิก
          {settings && !settings.enabled ? (
            <span className="members-slim-pill">ปิด</span>
          ) : null}
        </h1>
        <div className="staff-hub-head-actions">
          {(
            [
              ["list", "รายชื่อ"],
              ["claim", "QR สลิป"],
              ["settings", "ตั้งค่า"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={tab === key ? "primary-btn staff-btn-sm" : "ghost-btn staff-btn-sm"}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
          <a href="/members/spin-demo/" className="ghost-btn staff-btn-sm" title="ทดลองหลังร้าน — ยังไม่เปิดลูกค้า">
            จำลองคูณแต้ม (เทส)
          </a>
          {tab === "list" && canManage ? (
            <button
              type="button"
              className="primary-btn staff-btn-sm"
              onClick={() => {
                setShowAdd((v) => !v);
                setMsg(null);
                setError(null);
              }}
            >
              {showAdd ? "ปิดฟอร์ม" : "+ สมัคร"}
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <p className="staff-hub-msg members-slim-msg" style={{ color: "var(--danger, #b42318)" }}>
          {error}
        </p>
      ) : null}
      {msg ? <p className="staff-hub-msg members-slim-msg">{msg}</p> : null}

      {tab === "claim" ? (
        <section className="staff-hub-panel members-slim-panel">
          <p className="members-slim-hint muted">
            ออก QR จากบิลเพื่อเทสสแกน · เมื่อเปิดธง QR สลิป เครื่องขายพิมพ์ QR ทุกใบเอง
            {!settings?.enabled || !settings.receiptClaimEnabled
              ? " · เปิดธงที่ตั้งค่าก่อน"
              : ""}
          </p>
          <form
            className="members-slim-inline"
            onSubmit={(e) => {
              e.preventDefault();
              void onIssueClaim(claimSaleId);
            }}
          >
            <input
              type="text"
              value={claimSaleId}
              onChange={(e) => setClaimSaleId(e.target.value)}
              placeholder="saleId หรือเลือกบิลด้านล่าง"
              disabled={!canManage || saving}
            />
            {canManage ? (
              <>
                <button type="submit" className="primary-btn staff-btn-sm" disabled={saving}>
                  แสดง QR
                </button>
                <button
                  type="button"
                  className="ghost-btn staff-btn-sm"
                  disabled={saving || !claimSaleId.trim()}
                  onClick={() => void onIssueClaim(claimSaleId, true)}
                >
                  โทเคนใหม่ (เทส)
                </button>
              </>
            ) : null}
          </form>

          {claimIssue ? (
            <div
              ref={claimQrPanelRef}
              id="members-claim-qr-panel"
              className="members-claim-qr members-claim-qr--slim"
            >
              <p className="members-slim-line">
                {claimIssue.billNo} · {claimIssue.total}฿ → <strong>{claimIssue.pointsPreview}</strong>{" "}
                แต้ม
                {claimIssue.claimed ? <span className="muted"> · เคลมแล้ว (QR เดิม)</span> : null}
                {!claimIssue.claimed && claimIssue.reused ? (
                  <span className="muted"> · โทเคนเดิม</span>
                ) : null}
              </p>
              {claimQr ? (
                <img src={claimQr} alt="QR เคลมแต้ม" className="members-claim-qr-img" />
              ) : (
                <p className="muted members-slim-hint">กำลังสร้าง QR...</p>
              )}
              <code className="members-slim-code">{claimIssue.claimUrl}</code>
              <div className="members-slim-actions">
                <button
                  type="button"
                  className="ghost-btn staff-btn-sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(claimIssue.claimUrl);
                      setMsg("คัดลอกแล้ว");
                    } catch {
                      setError("คัดลอกไม่ได้");
                    }
                  }}
                >
                  คัดลอก
                </button>
                <a
                  className="ghost-btn staff-btn-sm"
                  href={claimIssue.claimUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  เปิด
                </a>
                <button
                  type="button"
                  className="ghost-btn staff-btn-sm"
                  disabled={saving}
                  onClick={() => void onIssueClaim(claimIssue.saleId, false)}
                >
                  QR เดิม
                </button>
                <button
                  type="button"
                  className="ghost-btn staff-btn-sm"
                  disabled={saving}
                  onClick={() => void onIssueClaim(claimIssue.saleId, true)}
                >
                  โทเคนใหม่ (เทส)
                </button>
              </div>
            </div>
          ) : null}

          <div className="table-wrap members-slim-table-wrap">
            <table className="sheet-table sheet-table--dense members-slim-table members-slim-table--claim">
              <thead>
                <tr>
                  <th className="members-col-bill">บิล</th>
                  <th className="members-col-status">สถานะ</th>
                  <th className="num members-col-amt">ยอด</th>
                  <th className="members-col-when">เวลา</th>
                  <th className="members-col-act">QR</th>
                </tr>
              </thead>
              <tbody>
                {todaySales.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      ยังไม่มีบิลวันนี้
                    </td>
                  </tr>
                ) : (
                  todaySales.slice(0, 40).map((s) => (
                    <tr
                      key={s.id}
                      className={claimIssue?.saleId === s.id ? "is-selected" : undefined}
                    >
                      <td className="members-col-bill">
                        <span className="members-cell-strong">{s.billNo}</span>
                      </td>
                      <td className="members-col-status muted">
                        {s.claimStatus === "claimed" ? "เคลมแล้ว" : "—"}
                      </td>
                      <td className="num members-col-amt">{s.total}</td>
                      <td className="members-col-when muted">{formatWhen(s.createdAt)}</td>
                      <td className="members-col-act">
                        <button
                          type="button"
                          className="primary-btn staff-btn-sm members-claim-row-btn"
                          disabled={!canManage || saving}
                          title={
                            s.claimStatus === "claimed"
                              ? "แสดง QR เดิม (เคลมแล้ว)"
                              : "แสดง / ออก QR"
                          }
                          onClick={() => {
                            setClaimSaleId(s.id);
                            void onIssueClaim(s.id);
                          }}
                        >
                          {s.claimStatus === "claimed" ? "ดู QR" : "QR"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : tab === "settings" ? (
        <section className="staff-hub-panel members-slim-panel">
          <div className="members-gate">
            <p className="members-gate-title">เกตเปิดใช้หน้าร้าน (P6)</p>
            <p className="members-gate-status">
              สมาชิก:{" "}
              <strong>{setEnabled ? "เปิด" : "ปิด"}</strong>
              {" · "}
              QR สลิป:{" "}
              <strong>{setReceiptClaim ? "เปิด (พิมพ์ทุกใบ)" : "ปิด"}</strong>
              {" · "}
              QR ให้แต้ม:{" "}
              <strong>{setCompCoupon ? "เปิด" : "ปิด"}</strong>
            </p>
            <ul className="members-gate-list">
              <li>เทสเครื่องครบก่อนเปิด — ดู docs/members-p6-gate.md</li>
              <li>พนักงานอ่านคู่มือ 1 หน้า — docs/members-staff-guide.md</li>
              <li>
                ฉุกเฉิน: ปิด «เปิดระบบสมาชิก» แล้วบันทึก — ขายปกติทันที · ปิดแค่ QR ได้ถ้าปัญหาอยู่ที่สลิป
              </li>
            </ul>
            {canManage ? (
              <div className="members-gate-actions">
                <button
                  type="button"
                  className="ghost-btn staff-btn-sm"
                  disabled={saving}
                  onClick={() => setSetBaht("33")}
                >
                  ใช้เรทแนะนำ 33฿=1 แต้ม
                </button>
                {setEnabled ? (
                  <button
                    type="button"
                    className="ghost-btn staff-btn-sm"
                    disabled={saving}
                    onClick={() => {
                      setSetEnabled(false);
                      setMsg("ติ๊กปิดแล้ว — กดบันทึกเพื่อปิดธงฉุกเฉิน");
                    }}
                  >
                    เตรียมปิดฉุกเฉิน
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <form className="members-slim-settings" onSubmit={onSaveSettings}>
            <label className="members-slim-check">
              <input
                type="checkbox"
                checked={setEnabled}
                disabled={!canManage || saving}
                onChange={(e) => setSetEnabled(e.target.checked)}
              />
              <span>เปิดระบบสมาชิก (หน้าร้าน + แลกแต้ม)</span>
            </label>
            <label>
              <span>สะสม: ทุกกี่บาทชำระ = 1 แต้ม</span>
              <input
                type="number"
                min={1}
                step={1}
                value={setBaht}
                disabled={!canManage || saving}
                onChange={(e) => setSetBaht(e.target.value)}
                required
              />
            </label>
            <p className="muted members-slim-hint">
              คิดจากยอดชำระหลังหักแลกแต้ม · ปัดลงแล้วขั้นต่ำ 1 แต้มต่อบิลที่จ่ายจริง (เมนูถูก ~13฿ ไม่ได้ 0) ·
              แนะนำเริ่ม 33 ≈ คืน ~3% เมื่อแลก 1:1
            </p>
            <label>
              <span>แลก: กี่แต้ม = ส่วนลด 1฿</span>
              <input
                type="number"
                min={1}
                step={1}
                value={setRedeem}
                disabled={!canManage || saving}
                onChange={(e) => setSetRedeem(e.target.value)}
                required
              />
            </label>
            <p className="muted members-slim-hint">ร้านใช้ 1 = แลก 1 แต้มลด 1 บาท</p>
            <label>
              <span>โบนัสสมัคร</span>
              <input
                type="number"
                min={0}
                step={1}
                value={setBonus}
                disabled={!canManage || saving}
                onChange={(e) => setSetBonus(e.target.value)}
                required
              />
            </label>
            <label className="members-slim-check">
              <input
                type="checkbox"
                checked={setReceiptClaim}
                disabled={!canManage || saving}
                onChange={(e) => setSetReceiptClaim(e.target.checked)}
              />
              <span>ทดลอง QR สลิป — เปิดแล้วเครื่องพิมพ์ QR ทุกใบ (ใช้สูตรบาท/แต้มด้านบน · ค่าเริ่มปิด)</span>
            </label>
            <label>
              <span>อายุลิงก์เคลม (วัน)</span>
              <input
                type="number"
                min={1}
                max={365}
                step={1}
                value={setClaimTtl}
                disabled={!canManage || saving}
                onChange={(e) => setSetClaimTtl(e.target.value)}
                required
              />
            </label>
            <label className="members-slim-check">
              <input
                type="checkbox"
                checked={setCompCoupon}
                disabled={!canManage || saving}
                onChange={(e) => setSetCompCoupon(e.target.checked)}
              />
              <span>QR ให้แต้ม — พนักงานกดพิมพ์จากเครื่องขาย (1 แต้ม/ใบ · ใช้ครั้งเดียว)</span>
            </label>
            <label>
              <span>โควต้า QR ให้แต้ม ต่อวัน</span>
              <input
                type="number"
                min={0}
                max={10000}
                step={1}
                value={setCompQuota}
                disabled={!canManage || saving}
                onChange={(e) => setSetCompQuota(e.target.value)}
                required
              />
            </label>
            <p className="muted members-slim-hint">
              วันนี้ใช้ไปแล้ว {compIssuedToday}
              {setCompQuota ? ` / ${setCompQuota}` : ""} ใบ · นับตอนพิมพ์ · รีเซ็ตเที่ยงคืน
              (Asia/Bangkok) · แต้มต่อใบ = 1
            </p>
            <label className="members-slim-check">
              <input
                type="checkbox"
                checked={setPublic}
                disabled={!canManage || saving}
                onChange={(e) => setSetPublic(e.target.checked)}
              />
              <span>สมัครผ่าน /join</span>
            </label>
            {settings?.publicSignupEnabled && settings.publicSignupToken ? (
              <code className="members-slim-code">
                {typeof window !== "undefined"
                  ? `${window.location.origin}/join/?t=${settings.publicSignupToken}`
                  : `/join/?t=${settings.publicSignupToken}`}
              </code>
            ) : null}
            {canManage ? (
              <button type="submit" className="primary-btn staff-btn-sm" disabled={saving}>
                {saving ? "..." : "บันทึก"}
              </button>
            ) : (
              <p className="muted">ดูอย่างเดียว</p>
            )}
          </form>
        </section>
      ) : (
        <>
          <div className="members-slim-toolbar">
            <input
              type="search"
              placeholder="ค้นหาเบอร์ · ชื่อ · บัตร"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="muted members-slim-count">
              {filtered.length}
              {deferredQuery ? `/${members.length}` : ""}
            </span>
          </div>

          {showAdd && canManage ? (
            <form className="members-slim-inline members-slim-add" onSubmit={onAdd}>
              <input
                type="tel"
                inputMode="tel"
                value={addPhone}
                onChange={(e) => setAddPhone(e.target.value)}
                placeholder="เบอร์ *"
                required
                disabled={saving}
              />
              <input
                type="text"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="ชื่อ"
                disabled={saving}
              />
              <button type="submit" className="primary-btn staff-btn-sm" disabled={saving}>
                บันทึก
              </button>
            </form>
          ) : null}

          {loading ? (
            <p className="muted">กำลังโหลด...</p>
          ) : (
            <div
              className={`members-hub-layout members-slim-layout${
                selected ? " is-split" : ""
              }`}
            >
              <section className="staff-hub-panel members-slim-panel">
                {filtered.length === 0 ? (
                  <p className="muted">ยังไม่มีสมาชิก</p>
                ) : (
                  <div className="table-wrap members-slim-table-wrap">
                    <table className="sheet-table sheet-table--dense members-slim-table members-slim-table--list">
                      <thead>
                        <tr>
                          <th className="members-col-name">ชื่อ</th>
                          <th className="members-col-phone">เบอร์</th>
                          <th className="members-col-card">บัตร</th>
                          <th className="num members-col-pts">แต้ม</th>
                          <th className="members-col-status">สถานะ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((m) => (
                          <tr
                            key={m.id}
                            className={selected?.id === m.id ? "is-selected" : undefined}
                            onClick={() => {
                              setSelected(m);
                              setMsg(null);
                              setError(null);
                            }}
                          >
                            <td className="members-col-name">
                              <span className="members-cell-strong">{m.displayName || "—"}</span>
                            </td>
                            <td className="members-col-phone muted">{phoneLabel(m)}</td>
                            <td className="members-col-card muted">{m.cardNo}</td>
                            <td className="num members-col-pts">{m.pointsBalance}</td>
                            <td className="members-col-status muted">
                              {m.status === "active" ? "ปกติ" : "ระงับ"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {selected ? (
                <section className="staff-hub-panel members-slim-panel members-slim-detail">
                  <div className="members-slim-detail-head">
                    <div>
                      <strong>{selected.displayName}</strong>
                      <div className="muted members-slim-sub">
                        {phoneLabel(selected)} · {selected.cardNo} ·{" "}
                        {MEMBER_SOURCE_LABELS[selected.source]}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ghost-btn staff-btn-sm"
                      onClick={() => setSelected(null)}
                    >
                      ปิด
                    </button>
                  </div>

                  <p className="members-slim-points">
                    <strong>{selected.pointsBalance}</strong> แต้ม
                    <span className="muted"> · รวม {selected.lifetimePointsEarned}</span>
                  </p>

                  <form className="members-slim-settings" onSubmit={onSaveProfile}>
                    <label>
                      <span>ชื่อ</span>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        disabled={!canManage || saving}
                      />
                    </label>
                    <label>
                      <span>หมายเหตุ</span>
                      <input
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        disabled={!canManage || saving}
                      />
                    </label>
                    {canManage ? (
                      <div className="members-slim-actions">
                        <button type="submit" className="primary-btn staff-btn-sm" disabled={saving}>
                          บันทึก
                        </button>
                        <button
                          type="button"
                          className="ghost-btn staff-btn-sm"
                          disabled={saving}
                          onClick={() => void onToggleStatus()}
                        >
                          {selected.status === "active" ? "ระงับ" : "เปิดใช้"}
                        </button>
                        <button
                          type="button"
                          className="ghost-btn staff-btn-sm is-danger"
                          disabled={saving}
                          onClick={() => setConfirmDeleteOpen(true)}
                        >
                          ลบสมาชิก
                        </button>
                      </div>
                    ) : null}
                  </form>

                  {canAdjust ? (
                    <form className="members-slim-inline" onSubmit={onAdjustPoints}>
                      <input
                        type="number"
                        step={1}
                        value={pointsDelta}
                        onChange={(e) => setPointsDelta(e.target.value)}
                        placeholder="+/− แต้ม"
                        disabled={saving}
                        required
                      />
                      <input
                        value={pointsNote}
                        onChange={(e) => setPointsNote(e.target.value)}
                        placeholder="เหตุผล *"
                        disabled={saving}
                        required
                      />
                      <button type="submit" className="primary-btn staff-btn-sm" disabled={saving}>
                        ปรับ
                      </button>
                    </form>
                  ) : null}

                  <div className="table-wrap members-slim-table-wrap">
                    <table className="sheet-table sheet-table--dense members-slim-table members-slim-table--ledger">
                      <thead>
                        <tr>
                          <th className="members-col-when">เมื่อ</th>
                          <th className="members-col-reason">รายการ</th>
                          <th className="num members-col-delta">+/−</th>
                          <th className="num members-col-bal">คงเหลือ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledgerLoading ? (
                          <tr>
                            <td colSpan={4} className="muted">
                              กำลังโหลด...
                            </td>
                          </tr>
                        ) : ledger.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="muted">
                              ยังไม่มีรายการ
                            </td>
                          </tr>
                        ) : (
                          ledger.map((row) => (
                            <tr key={row.id}>
                              <td className="members-col-when muted">{formatWhen(row.createdAt)}</td>
                              <td className="members-col-reason">
                                <span className="members-cell-clip">
                                  {MEMBER_LEDGER_REASON_LABELS[row.reason] || row.reason}
                                  {row.saleId ? ` · ${row.saleId}` : ""}
                                  {row.note ? ` · ${row.note}` : ""}
                                </span>
                              </td>
                              <td className="num members-col-delta">
                                {row.delta > 0 ? `+${row.delta}` : row.delta}
                              </td>
                              <td className="num members-col-bal">{row.balanceAfter}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </>
      )}

      <PosConfirmDialog
        open={confirmDeleteOpen}
        title="ลบสมาชิก?"
        message={
          selected
            ? `ยืนยันลบ ${selected.displayName} (${phoneLabel(selected)}) — จะหายจากรายชื่อ และใช้แต้ม/แลกไม่ได้`
            : "ยืนยันลบสมาชิกนี้"
        }
        confirmLabel="ยืนยัน"
        cancelLabel="ยกเลิก"
        destructive
        busy={saving}
        onConfirm={() => void onConfirmDeleteMember()}
        onCancel={() => {
          if (!saving) setConfirmDeleteOpen(false);
        }}
      />
    </div>
  );
}
