# Sibling app on mypeer-501909 (same project as TellTea)

## Do

1. Prefer a **new Firebase project** for a new product.
2. If you must share `mypeer-501909`:
   - Copy `firebase.hosting-only.json` → your app’s `firebase.json` (edit `target` / `public`).
   - Add your collection rules into **TellTea** `firestore.rules` (never a separate tiny rules file).
   - Add the collection name to `SHARED_APP_MATCHES` in `scripts/assert-firestore-rules.mjs`.
   - Add the hosting domain to `scripts/enable-pos-auth-domains.mjs`.
   - Deploy only: `firebase deploy --only hosting:YOUR_TARGET`

## Do not

- `firebase deploy` (full) from the sibling repo
- `firebase deploy --only firestore` from the sibling repo
- Replace TellTea `firestore.rules` with an app-only rules file

Wiping rules breaks TellTea login / ledger / POS for the shop.
