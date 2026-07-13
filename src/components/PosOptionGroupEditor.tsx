"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Plus, Trash2, X } from "lucide-react";
import { PosSortableList } from "@/components/PosSortableList";
import {
  createMenuOptionChoice,
  saveMenuOptionGroupFull,
  type MenuOptionGroupInput,
} from "@/lib/pos-menu-options";
import type { MenuOptionChoice, MenuOptionGroup, MenuOptionSelectionType } from "@/lib/types";

export function PosOptionGroupEditor({
  group,
  onBack,
  onSaved,
  onDelete,
  modal = false,
}: {
  group: MenuOptionGroup;
  onBack: () => void;
  onSaved: () => void;
  onDelete: () => void;
  modal?: boolean;
}) {
  const [name, setName] = useState(group.name);
  const [required, setRequired] = useState(group.required);
  const [selectionType, setSelectionType] = useState<MenuOptionSelectionType>(group.selectionType);
  const [minSelect, setMinSelect] = useState(group.minSelect ?? 1);
  const [maxSelect, setMaxSelect] = useState(group.maxSelect ?? 2);
  const [options, setOptions] = useState<MenuOptionChoice[]>(group.options);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(group.name);
    setRequired(group.required);
    setSelectionType(group.selectionType);
    setMinSelect(group.minSelect ?? 1);
    setMaxSelect(group.maxSelect ?? 2);
    setOptions(group.options);
  }, [group]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const input: MenuOptionGroupInput = {
      name,
      required,
      selectionType,
      minSelect: selectionType === "multi" ? minSelect : undefined,
      maxSelect: selectionType === "multi" ? maxSelect : undefined,
      options,
    };
    try {
      await saveMenuOptionGroupFull(group.id, input);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function addOption() {
    setOptions((prev) => [...prev, createMenuOptionChoice("", 0)]);
  }

  function updateOption(id: string, patch: Partial<MenuOptionChoice>) {
    setOptions((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }

  function removeOption(id: string) {
    setOptions((prev) => prev.filter((o) => o.id !== id));
  }

  return (
    <div className={modal ? "pos-menu-editor-modal" : "pos-menu-admin-screen"}>
      {!modal ? (
        <header className="pos-menu-admin-head">
          <button type="button" className="ghost-btn pos-menu-back" onClick={onBack}>
            <ArrowLeft size={18} aria-hidden />
            กลับ
          </button>
          <h1>แก้ไขกลุ่มตัวเลือก</h1>
        </header>
      ) : null}

      <form className="pos-menu-editor-form" onSubmit={(e) => void onSave(e)}>
        <label>
          <span>ชื่อกลุ่มตัวเลือก</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>

        <label className="pos-menu-toggle-row">
          <span>ลูกค้าจำเป็นต้องเลือก</span>
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
        </label>

        <fieldset className="pos-menu-fieldset">
          <legend>จำนวนตัวเลือกที่เลือกได้</legend>
          <label className="pos-menu-radio">
            <input
              type="radio"
              name="selType"
              checked={selectionType === "single"}
              onChange={() => setSelectionType("single")}
            />
            1 ตัวเลือก
          </label>
          <label className="pos-menu-radio">
            <input
              type="radio"
              name="selType"
              checked={selectionType === "multi"}
              onChange={() => setSelectionType("multi")}
            />
            มากกว่า 1 พร้อมกัน
            {selectionType === "multi" ? (
              <span className="pos-menu-inline-nums">
                <input
                  type="number"
                  min={1}
                  value={minSelect}
                  onChange={(e) => setMinSelect(Number(e.target.value) || 1)}
                />
                –
                <input
                  type="number"
                  min={1}
                  value={maxSelect}
                  onChange={(e) => setMaxSelect(Number(e.target.value) || 1)}
                />
              </span>
            ) : null}
          </label>
          <label className="pos-menu-radio">
            <input
              type="radio"
              name="selType"
              checked={selectionType === "unlimited"}
              onChange={() => setSelectionType("unlimited")}
            />
            ไม่จำกัด
          </label>
        </fieldset>

        <div className="pos-menu-options-head">
          <h2>ตัวเลือก</h2>
          <button type="button" className="ghost-btn pos-menu-btn-sm" onClick={addOption}>
            <Plus size={14} aria-hidden /> เพิ่ม
          </button>
        </div>

        <p className="muted pos-menu-sort-hint">กด ↑↓ เลื่อนลำดับตัวเลือก</p>

        <PosSortableList
          ids={options.map((o) => o.id)}
          onReorder={(ids) => {
            const byId = new Map(options.map((o) => [o.id, o]));
            setOptions(ids.map((id) => byId.get(id)).filter((o): o is MenuOptionChoice => o != null));
          }}
          className="pos-menu-option-rows"
          renderItem={(optId) => {
            const opt = options.find((o) => o.id === optId);
            if (!opt) return null;
            return (
              <>
                <input
                  value={opt.name}
                  placeholder="ชื่อตัวเลือก"
                  onChange={(e) => updateOption(opt.id, { name: e.target.value })}
                />
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={opt.priceDelta}
                  onChange={(e) => updateOption(opt.id, { priceDelta: Number(e.target.value) || 0 })}
                  title="ราคาเพิ่ม"
                />
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => removeOption(opt.id)}
                  aria-label="ลบ"
                >
                  <X size={16} />
                </button>
              </>
            );
          }}
        />

        {error ? <p className="error-text">{error}</p> : null}

        <button type="button" className="ghost-btn pos-menu-delete-btn pos-menu-btn-sm" onClick={() => void onDelete()}>
          <Trash2 size={14} aria-hidden /> ลบกลุ่ม
        </button>

        <div className="pos-menu-editor-actions">
          {modal ? (
            <button type="button" className="ghost-btn pos-menu-btn-sm" onClick={onBack}>
              ยกเลิก
            </button>
          ) : null}
          <button type="submit" className="primary-btn pos-menu-save-btn pos-menu-btn-sm" disabled={busy}>
            {busy ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </form>
    </div>
  );
}
