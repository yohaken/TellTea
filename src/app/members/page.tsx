"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { mapFirestoreError } from "@/lib/firestore-errors";
import {
  adjustMemberPoints,
  createMember,
  filterMembers,
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
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(ms));
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
  const [addBirthday, setAddBirthday] = useState("");
  const [addNote, setAddNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [selected, setSelected] = useState<ShopMember | null>(null);
  const [editName, setEditName] = useState("");
  const [editBirthday, setEditBirthday] = useState("");
  const [editNote, setEditNote] = useState("");
  const [ledger, setLedger] = useState<MemberLedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [pointsDelta, setPointsDelta] = useState("");
  const [pointsNote, setPointsNote] = useState("");

  const [setEnabled, setSetEnabled] = useState(false);
  const [setBaht, setSetBaht] = useState("25");
  const [setRedeem, setSetRedeem] = useState("1");
  const [setBonus, setSetBonus] = useState("0");
  const [setPublic, setSetPublic] = useState(false);
  const [setReceiptClaim, setSetReceiptClaim] = useState(false);
  const [setEarnPercent, setSetEarnPercent] = useState("1");
  const [setClaimTtl, setSetClaimTtl] = useState("30");

  const [todaySales, setTodaySales] = useState<PosSale[]>([]);
  const [claimSaleId, setClaimSaleId] = useState("");
  const [claimIssue, setClaimIssue] = useState<ReceiptClaimIssue | null>(null);
  const [claimQr, setClaimQr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!canHub) return;
    setLoading(true);
    setError(null);
    try {
      const [list, cfg] = await Promise.all([listMembers(), getMemberSettings()]);
      setMembers(list);
      setSettings(cfg);
      setSetEnabled(cfg.enabled);
      setSetBaht(String(cfg.bahtPerPoint));
      setSetRedeem(String(cfg.pointsPerBahtRedeem));
      setSetBonus(String(cfg.signupBonusPoints));
      setSetPublic(cfg.publicSignupEnabled);
      setSetReceiptClaim(cfg.receiptClaimEnabled);
      setSetEarnPercent(String(cfg.earnPercent));
      setSetClaimTtl(String(cfg.claimTokenTtlDays));
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
    if (staff && !canHub) {
      router.replace("/ledger/");
    }
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
    setEditBirthday(selected.birthday);
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
        {
          phone: addPhone,
          displayName: addName,
          birthday: addBirthday,
          note: addNote,
          source: "staff_boh",
        },
        actorId,
      );
      setShowAdd(false);
      setAddPhone("");
      setAddName("");
      setAddBirthday("");
      setAddNote("");
      setMsg(`สมัครแล้ว · ${created.displayName} · บัตร ${created.cardNo}`);
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
        {
          displayName: editName,
          birthday: editBirthday,
          note: editNote,
        },
        actorId,
      );
      setSelected(next);
      setMsg("บันทึกโปรไฟล์แล้ว");
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
      const next = await updateMember(
        selected.id,
        { status: nextStatus },
        actorId,
      );
      setSelected(next);
      setMsg(nextStatus === "active" ? "เปิดใช้บัตรแล้ว" : "ระงับบัตรแล้ว");
      await reload();
    } catch (err) {
      setError(mapFirestoreError(err, "เปลี่ยนสถานะ"));
    } finally {
      setSaving(false);
    }
  }

  async function onAdjustPoints(e: FormEvent) {
    e.preventDefault();
    if (!canAdjust || !actorId || !selected) return;
    const delta = Math.trunc(Number(pointsDelta));
    if (!Number.isFinite(delta) || !delta) {
      setError("ใส่จำนวนแต้มเป็นจำนวนเต็มที่ไม่เป็นศูนย์");
      return;
    }
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const next = await adjustMemberPoints(
        {
          memberId: selected.id,
          delta,
          reason: "adjust",
          note: pointsNote,
        },
        actorId,
      );
      setSelected(next);
      setPointsDelta("");
      setPointsNote("");
      setMsg(`ปรับแต้มแล้ว · ยอด ${next.pointsBalance}`);
      const rows = await listMemberLedger(next.id);
      setLedger(rows);
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
    const earnPercent = Number(setEarnPercent);
    const claimTtl = Number(setClaimTtl);
    if (!(baht > 0) || !(redeem > 0) || !(bonus >= 0) || !Number.isFinite(bonus)) {
      setError("ค่าตั้งค่าแต้มไม่ถูกต้อง");
      return;
    }
    if (!(earnPercent > 0) || earnPercent > 100 || !Number.isFinite(earnPercent)) {
      setError("% สะสมจากสลิปต้องอยู่ระหว่าง 0–100");
      return;
    }
    if (!(claimTtl >= 1) || claimTtl > 365 || !Number.isFinite(claimTtl)) {
      setError("อายุลิงก์เคลมต้องเป็น 1–365 วัน");
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
          earnPercent,
          claimTokenTtlDays: Math.floor(claimTtl),
        },
        actorId,
      );
      setSettings(next);
      setMsg("บันทึกตั้งค่าสมาชิกแล้ว");
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
      const qr = await claimQrDataUrl(issued.claimUrl);
      setClaimQr(qr);
      setMsg(
        issued.reused
          ? `ใช้ลิงก์เดิม · บิล ${issued.billNo} · ~${issued.pointsPreview} แต้ม`
          : `ออก QR แล้ว · บิล ${issued.billNo} · ~${issued.pointsPreview} แต้ม`,
      );
    } catch (err) {
      setError(mapFirestoreError(err, "ออก QR เคลม"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="staff-hub members-hub">
      <header className="staff-hub-head">
        <div>
          <h1 className="staff-hub-title">สมาชิก / แต้ม</h1>
          <p className="staff-hub-sub muted">
            บัตรสมาชิก · สะสมแต้ม · สาขาเดียว
            {settings && !settings.enabled ? " · ระบบปิดชั่วคราว" : ""}
            {settings?.receiptClaimEnabled ? " · ทดลอง QR สลิป" : ""}
          </p>
        </div>
        <div className="staff-hub-head-actions">
          <button
            type="button"
            className={tab === "list" ? "primary-btn staff-btn-sm" : "ghost-btn staff-btn-sm"}
            onClick={() => setTab("list")}
          >
            รายชื่อ
          </button>
          <button
            type="button"
            className={tab === "claim" ? "primary-btn staff-btn-sm" : "ghost-btn staff-btn-sm"}
            onClick={() => setTab("claim")}
          >
            QR สลิป
          </button>
          <button
            type="button"
            className={
              tab === "settings" ? "primary-btn staff-btn-sm" : "ghost-btn staff-btn-sm"
            }
            onClick={() => setTab("settings")}
          >
            ตั้งค่า
          </button>
          {tab === "list" && canManage ? (
            <button
              type="button"
              className="primary-btn staff-btn-sm"
              onClick={() => {
                setShowAdd(true);
                setMsg(null);
                setError(null);
              }}
            >
              สมัครสมาชิก
            </button>
          ) : null}
        </div>
      </header>

      {error ? <p className="staff-hub-msg" style={{ color: "var(--danger, #b42318)" }}>{error}</p> : null}
      {msg ? <p className="staff-hub-msg">{msg}</p> : null}

      {tab === "claim" ? (
        <section className="staff-hub-panel">
          <div className="staff-hub-panel-head">
            <h2 className="staff-hub-panel-title">ออก QR เคลมจากบิล (ทดลอง)</h2>
            <p className="staff-hub-panel-hint muted">
              เลือกบิลจริงหรือใส่รหัสบิล → สแกนด้วยมือถือคุณเอง · ยังไม่พิมพ์ที่เคาน์เตอร์
            </p>
          </div>
          <p className="members-claim-banner">
            โหมดทดลองเจ้าของร้าน · อย่าเปิดขายจริงให้ลูกค้าจนกว่าจะทดลองครบ
          </p>
          {!settings?.enabled || !settings.receiptClaimEnabled ? (
            <p className="muted">
              เปิด «ระบบสมาชิก» และ «ทดลองเคลมจาก QR สลิป» ที่แท็บตั้งค่าก่อน
            </p>
          ) : null}
          <form
            className="staff-compact-form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void onIssueClaim(claimSaleId);
            }}
          >
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>รหัสบิล (saleId)</span>
              <input
                type="text"
                value={claimSaleId}
                onChange={(e) => setClaimSaleId(e.target.value)}
                placeholder="วางรหัสบิลจาก /pos-sales หรือเลือกด้านล่าง"
                disabled={!canManage || saving}
              />
            </label>
            {canManage ? (
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button type="submit" className="primary-btn" disabled={saving}>
                  {saving ? "กำลังออก..." : "ออก QR / ลิงก์"}
                </button>
                {claimIssue ? (
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={saving}
                    onClick={() => void onIssueClaim(claimIssue.saleId, true)}
                  >
                    ออกโทเคนใหม่
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="muted">ดูอย่างเดียว</p>
            )}
          </form>

          {claimIssue ? (
            <div className="members-claim-qr">
              <p>
                บิล <strong>{claimIssue.billNo}</strong> · ยอด {claimIssue.total} บาท →{" "}
                <strong>{claimIssue.pointsPreview}</strong> แต้ม
              </p>
              {claimQr ? <img src={claimQr} alt="QR เคลมแต้ม" /> : null}
              <p className="muted" style={{ wordBreak: "break-all" }}>
                <code>{claimIssue.claimUrl}</code>
              </p>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="ghost-btn staff-btn-sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(claimIssue.claimUrl);
                      setMsg("คัดออกลิงก์แล้ว");
                    } catch {
                      setError("คัดลอกไม่ได้");
                    }
                  }}
                >
                  คัดออกลิงก์
                </button>
                <a
                  className="ghost-btn staff-btn-sm"
                  href={claimIssue.claimUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  เปิดหน้าเคลม
                </a>
              </div>
              <p className="muted">
                หมดอายุ{" "}
                {new Intl.DateTimeFormat("th-TH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(claimIssue.expiresAt))}
              </p>
            </div>
          ) : null}

          <div style={{ marginTop: "1.25rem" }}>
            <h3 className="staff-hub-panel-title" style={{ fontSize: "1rem" }}>
              บิลวันนี้ (เลือกเพื่อออก QR)
            </h3>
            {todaySales.length === 0 ? (
              <p className="muted">ยังไม่มีบิลวันนี้ — ใส่รหัสบิลเองได้</p>
            ) : (
              <ul className="staff-hub-list">
                {todaySales.slice(0, 40).map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="ghost-btn"
                      style={{ width: "100%", textAlign: "left" }}
                      disabled={!canManage || saving || s.claimStatus === "claimed"}
                      onClick={() => {
                        setClaimSaleId(s.id);
                        void onIssueClaim(s.id);
                      }}
                    >
                      <strong>{s.billNo}</strong> · {s.total} บาท ·{" "}
                      {formatWhen(s.createdAt)}
                      {s.claimStatus === "claimed"
                        ? " · เคลมแล้ว"
                        : s.claimToken
                          ? " · มีโทเคน"
                          : ""}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : tab === "settings" ? (
        <section className="staff-hub-panel">
          <div className="staff-hub-panel-head">
            <h2 className="staff-hub-panel-title">กฎแต้มร้าน</h2>
            <p className="staff-hub-panel-hint muted">
              กฎแต้มร้าน · ทดลอง QR สลิป (R0) ค่าเริ่มปิด · ยังไม่กระทบหน้าร้าน
            </p>
          </div>
          {!canManage ? (
            <p className="muted">ดูอย่างเดียว — ต้องมีสิทธิ์จัดการสมาชิกถึงจะแก้ได้</p>
          ) : null}
          <form className="staff-compact-form-grid" onSubmit={onSaveSettings}>
            <label className="field">
              <span>เปิดระบบสมาชิก</span>
              <input
                type="checkbox"
                checked={setEnabled}
                disabled={!canManage || saving}
                onChange={(e) => setSetEnabled(e.target.checked)}
              />
            </label>
            <label className="field">
              <span>ทุกกี่บาท = 1 แต้ม</span>
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
            <label className="field">
              <span>แต้มต่อ 1 บาทส่วนลด (M3)</span>
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
            <label className="field">
              <span>โบนัสแต้มสมัครใหม่</span>
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
            <label className="field">
              <span>ทดลองเคลมจาก QR สลิป (ยังไม่ขายจริง)</span>
              <input
                type="checkbox"
                checked={setReceiptClaim}
                disabled={!canManage || saving}
                onChange={(e) => setSetReceiptClaim(e.target.checked)}
              />
            </label>
            <label className="field">
              <span>% ยอดสุทธิ → แต้ม (สลิป)</span>
              <input
                type="number"
                min={0.01}
                max={100}
                step={0.1}
                value={setEarnPercent}
                disabled={!canManage || saving}
                onChange={(e) => setSetEarnPercent(e.target.value)}
                required
              />
            </label>
            <label className="field">
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
            <p className="muted" style={{ gridColumn: "1 / -1" }}>
              โหมดทดลอง: เปิดธงด้านบนแล้วออก QR จากแท็บ «QR สลิป» — ยังไม่พิมพ์ที่เครื่องขาย
            </p>
            <label className="field">
              <span>เปิดสมัครผ่าน QR (หน้า /join)</span>
              <input
                type="checkbox"
                checked={setPublic}
                disabled={!canManage || saving}
                onChange={(e) => setSetPublic(e.target.checked)}
              />
            </label>
            {settings?.publicSignupEnabled && settings.publicSignupToken ? (
              <p className="muted" style={{ gridColumn: "1 / -1" }}>
                ลิงก์สมัคร:{" "}
                <code style={{ wordBreak: "break-all" }}>
                  {typeof window !== "undefined"
                    ? `${window.location.origin}/join/?t=${settings.publicSignupToken}`
                    : `/join/?t=${settings.publicSignupToken}`}
                </code>
              </p>
            ) : (
              <p className="muted" style={{ gridColumn: "1 / -1" }}>
                เปิดช่องด้านบนแล้วกดบันทึก — ระบบจะสร้างโทเคนและลิงก์ให้
              </p>
            )}
            {canManage ? (
              <div>
                <button type="submit" className="primary-btn" disabled={saving}>
                  {saving ? "กำลังบันทึก..." : "บันทึกตั้งค่า"}
                </button>
              </div>
            ) : null}
          </form>
        </section>
      ) : (
        <>
          <div className="field" style={{ marginBottom: "0.75rem" }}>
            <label>
              <span className="sr-only">ค้นหา</span>
              <input
                type="search"
                placeholder="ค้นหาเบอร์ · ชื่อ · เลขบัตร"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>

          {showAdd && canManage ? (
            <section className="staff-hub-panel" style={{ marginBottom: "1rem" }}>
              <div className="staff-hub-panel-head">
                <h2 className="staff-hub-panel-title">สมัครสมาชิกใหม่</h2>
              </div>
              <form className="staff-compact-form-grid" onSubmit={onAdd}>
                <label className="field">
                  <span>เบอร์โทร *</span>
                  <input
                    type="tel"
                    inputMode="tel"
                    value={addPhone}
                    onChange={(e) => setAddPhone(e.target.value)}
                    placeholder="08x-xxx-xxxx"
                    required
                    disabled={saving}
                  />
                </label>
                <label className="field">
                  <span>ชื่อเรียก</span>
                  <input
                    type="text"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder="ชื่อเล่น / ชื่อลูกค้า"
                    disabled={saving}
                  />
                </label>
                <label className="field">
                  <span>วันเกิด</span>
                  <input
                    type="date"
                    value={addBirthday}
                    onChange={(e) => setAddBirthday(e.target.value)}
                    disabled={saving}
                  />
                </label>
                <label className="field">
                  <span>หมายเหตุ</span>
                  <input
                    type="text"
                    value={addNote}
                    onChange={(e) => setAddNote(e.target.value)}
                    disabled={saving}
                  />
                </label>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button type="submit" className="primary-btn" disabled={saving}>
                    {saving ? "กำลังสมัคร..." : "บันทึกสมัคร"}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={saving}
                    onClick={() => setShowAdd(false)}
                  >
                    ยกเลิก
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          {loading ? (
            <p className="staff-hub-loading muted">กำลังโหลด...</p>
          ) : (
            <div
              style={{
                display: "grid",
                gap: "1rem",
                gridTemplateColumns: selected ? "minmax(0, 1fr) minmax(0, 1.1fr)" : "1fr",
              }}
              className="members-hub-layout"
            >
              <section className="staff-hub-panel">
                <div className="staff-hub-panel-head">
                  <h2 className="staff-hub-panel-title">
                    รายชื่อ ({filtered.length}
                    {deferredQuery ? ` / ${members.length}` : ""})
                  </h2>
                </div>
                {filtered.length === 0 ? (
                  <p className="muted">ยังไม่มีสมาชิก{deferredQuery ? "ที่ตรงค้นหา" : ""}</p>
                ) : (
                  <div className="table-wrap">
                    <table className="sheet-table sheet-table--dense">
                      <thead>
                        <tr>
                          <th>ชื่อ</th>
                          <th>เบอร์</th>
                          <th>แต้ม</th>
                          <th>สถานะ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((m) => (
                          <tr
                            key={m.id}
                            onClick={() => {
                              setSelected(m);
                              setMsg(null);
                              setError(null);
                            }}
                            style={{
                              cursor: "pointer",
                              background:
                                selected?.id === m.id
                                  ? "rgba(0,0,0,0.04)"
                                  : undefined,
                            }}
                          >
                            <td>
                              <strong>{m.displayName || "—"}</strong>
                              <div className="muted" style={{ fontSize: "0.85em" }}>
                                {m.cardNo}
                              </div>
                            </td>
                            <td>
                              {(() => {
                                try {
                                  return formatPhoneDisplay(m.phone);
                                } catch {
                                  return m.phone || m.phoneDigits;
                                }
                              })()}
                            </td>
                            <td>{m.pointsBalance}</td>
                            <td>{m.status === "active" ? "ใช้ได้" : "ระงับ"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {selected ? (
                <section className="staff-hub-panel">
                  <div className="staff-hub-panel-head">
                    <h2 className="staff-hub-panel-title">{selected.displayName}</h2>
                    <button
                      type="button"
                      className="ghost-btn staff-btn-sm"
                      onClick={() => setSelected(null)}
                    >
                      ปิด
                    </button>
                  </div>
                  <p className="muted" style={{ marginTop: 0 }}>
                    บัตร {selected.cardNo} ·{" "}
                    {MEMBER_SOURCE_LABELS[selected.source]} · อัปเดต{" "}
                    {formatWhen(selected.updatedAt)}
                  </p>
                  <p>
                    <strong>{selected.pointsBalance}</strong> แต้ม
                    <span className="muted">
                      {" "}
                      · สะสมรวม {selected.lifetimePointsEarned}
                    </span>
                  </p>

                  <form className="staff-compact-form-grid" onSubmit={onSaveProfile}>
                    <label className="field">
                      <span>ชื่อเรียก</span>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        disabled={!canManage || saving}
                      />
                    </label>
                    <label className="field">
                      <span>วันเกิด</span>
                      <input
                        type="date"
                        value={editBirthday}
                        onChange={(e) => setEditBirthday(e.target.value)}
                        disabled={!canManage || saving}
                      />
                    </label>
                    <label className="field">
                      <span>หมายเหตุ</span>
                      <input
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        disabled={!canManage || saving}
                      />
                    </label>
                    {canManage ? (
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <button type="submit" className="primary-btn" disabled={saving}>
                          บันทึกโปรไฟล์
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          disabled={saving}
                          onClick={() => void onToggleStatus()}
                        >
                          {selected.status === "active" ? "ระงับบัตร" : "เปิดใช้บัตร"}
                        </button>
                      </div>
                    ) : null}
                  </form>

                  {canAdjust ? (
                    <form
                      className="staff-compact-form-grid"
                      style={{ marginTop: "1rem" }}
                      onSubmit={onAdjustPoints}
                    >
                      <h3 className="staff-hub-panel-title" style={{ gridColumn: "1 / -1" }}>
                        ปรับแต้ม
                      </h3>
                      <label className="field">
                        <span>จำนวน (+/−)</span>
                        <input
                          type="number"
                          step={1}
                          value={pointsDelta}
                          onChange={(e) => setPointsDelta(e.target.value)}
                          placeholder="เช่น 10 หรือ -5"
                          disabled={saving}
                          required
                        />
                      </label>
                      <label className="field">
                        <span>เหตุผล *</span>
                        <input
                          value={pointsNote}
                          onChange={(e) => setPointsNote(e.target.value)}
                          placeholder="จำเป็นทุกครั้งที่ปรับมือ"
                          disabled={saving}
                          required
                        />
                      </label>
                      <div>
                        <button type="submit" className="primary-btn" disabled={saving}>
                          บันทึกแต้ม
                        </button>
                      </div>
                    </form>
                  ) : null}

                  <div style={{ marginTop: "1.25rem" }}>
                    <h3 className="staff-hub-panel-title">ประวัติแต้ม</h3>
                    {ledgerLoading ? (
                      <p className="muted">กำลังโหลด...</p>
                    ) : ledger.length === 0 ? (
                      <p className="muted">ยังไม่มีรายการ</p>
                    ) : (
                      <div className="table-wrap">
                        <table className="sheet-table sheet-table--dense">
                          <thead>
                            <tr>
                              <th>เมื่อ</th>
                              <th>รายการ</th>
                              <th>+/−</th>
                              <th>คงเหลือ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ledger.map((row) => (
                              <tr key={row.id}>
                                <td>{formatWhen(row.createdAt)}</td>
                                <td>
                                  {MEMBER_LEDGER_REASON_LABELS[row.reason]}
                                  {row.note ? (
                                    <div className="muted" style={{ fontSize: "0.85em" }}>
                                      {row.note}
                                    </div>
                                  ) : null}
                                </td>
                                <td>
                                  {row.delta > 0 ? `+${row.delta}` : row.delta}
                                </td>
                                <td>{row.balanceAfter}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
