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
import { formatPhoneDisplay } from "@/lib/utils";

type TabKey = "list" | "settings";

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

  const [setEnabled, setSetEnabled] = useState(true);
  const [setBaht, setSetBaht] = useState("25");
  const [setRedeem, setSetRedeem] = useState("1");
  const [setBonus, setSetBonus] = useState("0");
  const [setPublic, setSetPublic] = useState(false);

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
    if (!(baht > 0) || !(redeem > 0) || !(bonus >= 0) || !Number.isFinite(bonus)) {
      setError("ค่าตั้งค่าแต้มไม่ถูกต้อง");
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

  return (
    <div className="staff-hub members-hub">
      <header className="staff-hub-head">
        <div>
          <h1 className="staff-hub-title">สมาชิก / แต้ม</h1>
          <p className="staff-hub-sub muted">
            บัตรสมาชิก · สะสมแต้ม · สาขาเดียว
            {settings && !settings.enabled ? " · ระบบปิดชั่วคราว" : ""}
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

      {tab === "settings" ? (
        <section className="staff-hub-panel">
          <div className="staff-hub-panel-head">
            <h2 className="staff-hub-panel-title">กฎแต้มร้าน</h2>
            <p className="staff-hub-panel-hint muted">
              ใช้ตอน POS สะสมแต้ม (M2) · QR สมัครเองจองธงไว้ก่อน (M4)
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
              <span>เตรียม QR สมัครเอง (ยังไม่เปิดหน้าสาธารณะ)</span>
              <input
                type="checkbox"
                checked={setPublic}
                disabled={!canManage || saving}
                onChange={(e) => setSetPublic(e.target.checked)}
              />
            </label>
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
