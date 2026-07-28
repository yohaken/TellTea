# Pay chooser — large touch buttons (not Material list)

อัปเดต: **1.14.60** · `APP_BUILD` 318 · `POS_BUILD` 113 · vc **83**

## Problem (rejected)

Material `AlertDialog.setItems` for **เลือกวิธีชำระ**:

- thin list rows + orange CANCEL
- lots of empty white space
- not commercial / not table-first friendly

## Target (1.14.60+)

- Custom dialog: title + short hint
- **ชำระเงินสด** — large primary full-width (`NposUi.primary`)
- **โอนเงิน** — large secondary full-width (`NposUi.secondary`)
- **ยกเลิก** — ghost
- No `setItems` / no Material positive/negative for this path

## Ship

- [x] `SellActivity.startPayAll`
- [x] `docs/npos-friendly-ui-checklist.md` policy #8
- [x] `.cursor/rules/npos-friendly-ui.mdc` ban `setItems`
- [x] `scripts/test-npos-pay-chooser-touch.mjs`

```bash
node scripts/test-npos-pay-chooser-touch.mjs
node scripts/test-npos-friendly-ui.mjs
```
