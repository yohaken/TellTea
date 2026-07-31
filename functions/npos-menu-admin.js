/**
 * nPos menu admin — full catalog snapshot (incl. archived) + mutate CRUD.
 * Auth: installId + assertNposDeviceAllowed (same as sold-out / reorder).
 */
const functions = require("firebase-functions/v1");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { assertNposDeviceAllowed } = require("./npos-device-gate");

const MAX_IMAGE_CHARS = 900_000;
const MAX_IMAGE_SNAPSHOT = 180_000;

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === "object" ? body : null;
}

function requireInstallId(body) {
  const installId = asString(body?.installId, 64);
  if (!installId || installId.length < 8 || !/^[a-zA-Z0-9_-]+$/.test(installId)) {
    return null;
  }
  return installId;
}

async function rejectIfDeviceNotAllowed(db, installId, res) {
  const gate = await assertNposDeviceAllowed(db, installId);
  if (gate.ok) return null;
  res.status(403).json({
    ok: false,
    error: gate.error || "device_not_allowed",
    code: gate.code || "device_not_allowed",
    storeClaimRequired: gate.required,
    storeClaimed: gate.claimed,
  });
  return gate;
}

async function bumpMenuVersion(db) {
  const menuVersion = Date.now();
  await db.doc("meta/pos").set({ menuVersion }, { merge: true });
  return menuVersion;
}

function sanitizeLabel(v, max = 120) {
  return asString(v, max) || "";
}

function numPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function mapChoice(o, idx) {
  if (!o || typeof o !== "object") return null;
  const id = asString(o.id, 64) || `c_${Date.now()}_${idx}`;
  const name = sanitizeLabel(o.name, 80);
  if (!name) return null;
  const row = {
    id,
    name,
    priceDelta: numPrice(o.priceDelta),
    sortOrder: typeof o.sortOrder === "number" ? o.sortOrder : idx * 1000,
    active: o.active !== false,
  };
  if (typeof o.deliveryPriceDelta === "number") {
    row.deliveryPriceDelta = numPrice(o.deliveryPriceDelta);
  }
  return row;
}

function serializeChoices(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < raw.length && out.length < 40; i++) {
    const c = mapChoice(raw[i], i);
    if (c) out.push(c);
  }
  return out;
}

/** Full catalog for MenuAdmin — includes archived cats/items/groups + inactive choices. */
exports.nposMenuAdminSnapshot = functions
  .region("asia-southeast1")
  .runWith({ timeoutSeconds: 60, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "POST only" });
      return;
    }
    const body = parseBody(req);
    const installId = requireInstallId(body);
    if (!installId) {
      res.status(400).json({ ok: false, error: "installId_required" });
      return;
    }
    try {
      const db = getFirestore();
      if (await rejectIfDeviceNotAllowed(db, installId, res)) return;

      const [catsSnap, itemsSnap, groupsSnap, metaPos] = await Promise.all([
        db.collection("menuCategories").get(),
        db.collection("menuItems").get(),
        db.collection("menuOptionGroups").get(),
        db.doc("meta/pos").get(),
      ]);

      const categories = catsSnap.docs
        .map((d) => {
          const x = d.data() || {};
          return {
            id: d.id,
            name: asString(x.name, 80) || d.id,
            sortOrder: typeof x.sortOrder === "number" ? x.sortOrder : 0,
            active: x.active !== false,
          };
        })
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

      const optionGroups = groupsSnap.docs
        .map((d) => {
          const x = d.data() || {};
          const options = Array.isArray(x.options)
            ? x.options
                .map((o, i) => mapChoice(o, i))
                .filter(Boolean)
                .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
            : [];
          return {
            id: d.id,
            name: asString(x.name, 80) || d.id,
            required: x.required === true,
            selectionType: asString(x.selectionType, 20) || "single",
            minSelect: typeof x.minSelect === "number" ? x.minSelect : 0,
            maxSelect: typeof x.maxSelect === "number" ? x.maxSelect : 0,
            options,
            sortOrder: typeof x.sortOrder === "number" ? x.sortOrder : 0,
            active: x.active !== false,
          };
        })
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

      const items = itemsSnap.docs
        .map((d) => {
          const x = d.data() || {};
          const imageRaw = typeof x.imageUrl === "string" ? x.imageUrl.trim() : "";
          const imageUrl =
            imageRaw && imageRaw.length <= MAX_IMAGE_SNAPSHOT
              ? imageRaw
              : imageRaw
                ? imageRaw.slice(0, MAX_IMAGE_SNAPSHOT)
                : "";
          return {
            id: d.id,
            categoryId: asString(x.categoryId, 64),
            name: asString(x.name, 120) || d.id,
            nameEn: asString(x.nameEn, 120),
            code: asString(x.code, 40),
            description: asString(x.description, 500),
            price: Number(x.price) || 0,
            ...(typeof x.deliveryPrice === "number"
              ? { deliveryPrice: Number(x.deliveryPrice) || 0 }
              : {}),
            sortOrder: typeof x.sortOrder === "number" ? x.sortOrder : 0,
            active: x.active !== false,
            visibleOnPos: x.visibleOnPos !== false,
            recommended: x.recommended === true,
            optionGroupIds: Array.isArray(x.optionGroupIds)
              ? x.optionGroupIds.filter((id) => typeof id === "string").slice(0, 12)
              : [],
            imageUrl,
          };
        })
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

      let menuVersion = 0;
      const mv = metaPos.exists ? (metaPos.data() || {}).menuVersion : 0;
      const mvn = typeof mv === "number" ? mv : Number(mv);
      if (Number.isFinite(mvn) && mvn > 0) menuVersion = Math.round(mvn);

      res.status(200).json({
        ok: true,
        admin: true,
        fetchedAt: Date.now(),
        menuVersion,
        categories,
        items,
        optionGroups,
      });
    } catch (err) {
      console.error("nposMenuAdminSnapshot", err);
      res.status(500).json({ ok: false, error: "admin_snapshot_failed" });
    }
  });

/**
 * Body: { installId, action, ...payload }
 * Actions cover category / item / group CRUD parity with BOH pos-menu*.ts
 */
exports.nposMenuMutate = functions
  .region("asia-southeast1")
  .runWith({ timeoutSeconds: 60, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "POST only" });
      return;
    }
    const body = parseBody(req);
    const installId = requireInstallId(body);
    const action = asString(body?.action, 40);
    if (!installId || !action) {
      res.status(400).json({ ok: false, error: "installId_and_action_required" });
      return;
    }
    try {
      const db = getFirestore();
      if (await rejectIfDeviceNotAllowed(db, installId, res)) return;
      const result = await runMutate(db, installId, action, body || {});
      if (result.error) {
        res.status(result.status || 400).json({ ok: false, error: result.error });
        return;
      }
      const menuVersion = await bumpMenuVersion(db);
      res.status(200).json({ ok: true, menuVersion, ...result.data });
    } catch (err) {
      console.error("nposMenuMutate", action, err);
      res.status(500).json({ ok: false, error: "mutate_failed" });
    }
  });

async function runMutate(db, installId, action, body) {
  const now = Date.now();
  switch (action) {
    case "addCategory": {
      const name = sanitizeLabel(body.name, 80);
      if (!name) return { error: "name_required" };
      const ref = await db.collection("menuCategories").add({
        name,
        sortOrder: now,
        active: true,
        createdAt: now,
        updatedAt: now,
        source: "npos",
        createdBy: installId,
      });
      return { data: { id: ref.id } };
    }
    case "updateCategory": {
      const id = asString(body.id, 80);
      if (!id) return { error: "id_required" };
      const patch = { updatedAt: now, updatedBy: installId };
      if (body.name != null) patch.name = sanitizeLabel(body.name, 80);
      if (typeof body.active === "boolean") patch.active = body.active;
      if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;
      await db.doc(`menuCategories/${id}`).set(patch, { merge: true });
      return { data: { id } };
    }
    case "deleteCategory": {
      const id = asString(body.id, 80);
      if (!id) return { error: "id_required" };
      await db.doc(`menuCategories/${id}`).delete();
      return { data: { id } };
    }
    case "archiveCategory": {
      const id = asString(body.id, 80);
      if (!id) return { error: "id_required" };
      await db.doc(`menuCategories/${id}`).set(
        { active: false, updatedAt: now, updatedBy: installId },
        { merge: true },
      );
      return { data: { id } };
    }
    case "restoreCategory": {
      const id = asString(body.id, 80);
      if (!id) return { error: "id_required" };
      await db.doc(`menuCategories/${id}`).set(
        { active: true, updatedAt: now, updatedBy: installId },
        { merge: true },
      );
      return { data: { id } };
    }
    case "reorderCategories": {
      const ids = Array.isArray(body.categoryIds) ? body.categoryIds : [];
      if (!ids.length) return { error: "categoryIds_required" };
      const batch = db.batch();
      let n = 0;
      for (let i = 0; i < ids.length && i < 80; i++) {
        const id = asString(ids[i], 80);
        if (!id) continue;
        batch.set(
          db.doc(`menuCategories/${id}`),
          { sortOrder: (i + 1) * 1000, updatedAt: now, reorderedBy: installId },
          { merge: true },
        );
        n += 1;
      }
      if (!n) return { error: "no_valid_ids" };
      await batch.commit();
      return { data: { count: n } };
    }
    case "addItem": {
      const categoryId = asString(body.categoryId, 64);
      const name = sanitizeLabel(body.name, 120);
      if (!categoryId || !name) return { error: "categoryId_and_name_required" };
      const row = {
        categoryId,
        name,
        price: numPrice(body.price),
        sortOrder: now,
        active: true,
        visibleOnPos: true,
        recommended: false,
        source: "npos",
        createdAt: now,
        updatedAt: now,
        createdBy: installId,
      };
      if (typeof body.deliveryPrice === "number") row.deliveryPrice = numPrice(body.deliveryPrice);
      const ref = await db.collection("menuItems").add(row);
      return { data: { id: ref.id } };
    }
    case "updateItem": {
      const id = asString(body.id, 80);
      if (!id) return { error: "id_required" };
      const patch = { updatedAt: now, updatedBy: installId };
      if (body.categoryId != null) patch.categoryId = asString(body.categoryId, 64);
      if (body.name != null) patch.name = sanitizeLabel(body.name, 120);
      if (body.nameEn != null) patch.nameEn = sanitizeLabel(body.nameEn, 120);
      if (body.description != null) patch.description = asString(body.description, 500);
      if (body.price != null) patch.price = numPrice(body.price);
      if (body.deliveryPrice === null) {
        patch.deliveryPrice = FieldValue.delete();
      } else if (typeof body.deliveryPrice === "number") {
        patch.deliveryPrice = numPrice(body.deliveryPrice);
      }
      if (typeof body.active === "boolean") patch.active = body.active;
      if (typeof body.visibleOnPos === "boolean") patch.visibleOnPos = body.visibleOnPos;
      if (typeof body.recommended === "boolean") patch.recommended = body.recommended;
      if (body.imageUrl != null) {
        const img = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
        if (img.length > MAX_IMAGE_CHARS) return { error: "image_too_large" };
        patch.imageUrl = img;
      }
      if (Array.isArray(body.optionGroupIds)) {
        patch.optionGroupIds = body.optionGroupIds
          .filter((x) => typeof x === "string")
          .map((x) => asString(x, 64))
          .filter(Boolean)
          .slice(0, 12);
      }
      if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;
      if (body.code === null || body.code === "") {
        patch.code = FieldValue.delete();
      } else if (body.code != null) {
        patch.code = asString(body.code, 40);
      }
      await db.doc(`menuItems/${id}`).set(patch, { merge: true });
      return { data: { id } };
    }
    case "deleteItem": {
      const id = asString(body.id, 80);
      if (!id) return { error: "id_required" };
      await db.doc(`menuItems/${id}`).delete();
      return { data: { id } };
    }
    case "archiveItem": {
      const id = asString(body.id, 80);
      if (!id) return { error: "id_required" };
      await db.doc(`menuItems/${id}`).set(
        { active: false, visibleOnPos: false, updatedAt: now, updatedBy: installId },
        { merge: true },
      );
      return { data: { id } };
    }
    case "restoreItem": {
      const id = asString(body.id, 80);
      if (!id) return { error: "id_required" };
      await db.doc(`menuItems/${id}`).set(
        { active: true, visibleOnPos: true, updatedAt: now, updatedBy: installId },
        { merge: true },
      );
      return { data: { id } };
    }
    case "duplicateItem": {
      const id = asString(body.id, 80);
      if (!id) return { error: "id_required" };
      const snap = await db.doc(`menuItems/${id}`).get();
      if (!snap.exists) return { status: 404, error: "item_not_found" };
      const x = snap.data() || {};
      const row = {
        categoryId: asString(x.categoryId, 64),
        name: `${sanitizeLabel(x.name, 100)} (สำเนา)`,
        nameEn: asString(x.nameEn, 120),
        description: asString(x.description, 500),
        price: Number(x.price) || 0,
        sortOrder: now,
        active: x.active !== false,
        visibleOnPos: x.visibleOnPos !== false,
        recommended: x.recommended === true,
        optionGroupIds: Array.isArray(x.optionGroupIds)
          ? x.optionGroupIds.filter((g) => typeof g === "string").slice(0, 12)
          : [],
        imageUrl: typeof x.imageUrl === "string" ? x.imageUrl.slice(0, MAX_IMAGE_CHARS) : "",
        source: "npos",
        createdAt: now,
        updatedAt: now,
        createdBy: installId,
      };
      if (typeof x.deliveryPrice === "number") row.deliveryPrice = numPrice(x.deliveryPrice);
      if (x.code) row.code = asString(x.code, 40);
      const ref = await db.collection("menuItems").add(row);
      return { data: { id: ref.id } };
    }
    case "addGroup": {
      const name = sanitizeLabel(body.name, 80);
      if (!name) return { error: "name_required" };
      const ref = await db.collection("menuOptionGroups").add({
        name,
        required: false,
        selectionType: "single",
        options: [
          {
            id: `c_${now}`,
            name: "ไม่รับ",
            priceDelta: 0,
            sortOrder: 0,
            active: true,
          },
        ],
        sortOrder: now,
        active: true,
        source: "npos",
        createdAt: now,
        updatedAt: now,
        createdBy: installId,
      });
      return { data: { id: ref.id } };
    }
    case "updateGroup": {
      const id = asString(body.id, 80);
      if (!id) return { error: "id_required" };
      const patch = { updatedAt: now, updatedBy: installId };
      if (body.name != null) patch.name = sanitizeLabel(body.name, 80);
      if (typeof body.required === "boolean") patch.required = body.required;
      if (body.selectionType != null) {
        const sel = asString(body.selectionType, 20) || "single";
        patch.selectionType = ["single", "multi", "unlimited"].includes(sel) ? sel : "single";
        if (patch.selectionType === "single") {
          patch.maxSelect = 1;
          patch.minSelect = FieldValue.delete();
        } else {
          if (typeof body.minSelect === "number") patch.minSelect = Math.max(0, body.minSelect);
          if (typeof body.maxSelect === "number") patch.maxSelect = Math.max(0, body.maxSelect);
        }
      } else {
        if (typeof body.minSelect === "number") patch.minSelect = Math.max(0, body.minSelect);
        if (typeof body.maxSelect === "number") patch.maxSelect = Math.max(0, body.maxSelect);
      }
      if (Array.isArray(body.options)) patch.options = serializeChoices(body.options);
      if (typeof body.active === "boolean") patch.active = body.active;
      if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;
      await db.doc(`menuOptionGroups/${id}`).set(patch, { merge: true });
      return { data: { id } };
    }
    case "deleteGroup": {
      const id = asString(body.id, 80);
      if (!id) return { error: "id_required" };
      await db.doc(`menuOptionGroups/${id}`).delete();
      return { data: { id } };
    }
    case "archiveGroup": {
      const id = asString(body.id, 80);
      if (!id) return { error: "id_required" };
      await db.doc(`menuOptionGroups/${id}`).set(
        { active: false, updatedAt: now, updatedBy: installId },
        { merge: true },
      );
      return { data: { id } };
    }
    case "restoreGroup": {
      const id = asString(body.id, 80);
      if (!id) return { error: "id_required" };
      await db.doc(`menuOptionGroups/${id}`).set(
        { active: true, updatedAt: now, updatedBy: installId },
        { merge: true },
      );
      return { data: { id } };
    }
    case "duplicateGroup": {
      const id = asString(body.id, 80);
      if (!id) return { error: "id_required" };
      const snap = await db.doc(`menuOptionGroups/${id}`).get();
      if (!snap.exists) return { status: 404, error: "group_not_found" };
      const x = snap.data() || {};
      const options = serializeChoices(x.options).map((o, i) => ({
        ...o,
        id: `c_${now}_${i}`,
      }));
      const ref = await db.collection("menuOptionGroups").add({
        name: `${sanitizeLabel(x.name, 70)} (สำเนา)`,
        required: x.required === true,
        selectionType: asString(x.selectionType, 20) || "single",
        minSelect: typeof x.minSelect === "number" ? x.minSelect : 0,
        maxSelect: typeof x.maxSelect === "number" ? x.maxSelect : 0,
        options: options.length
          ? options
          : [{ id: `c_${now}`, name: "ไม่รับ", priceDelta: 0, sortOrder: 0, active: true }],
        sortOrder: now,
        active: true,
        source: "npos",
        createdAt: now,
        updatedAt: now,
        createdBy: installId,
      });
      return { data: { id: ref.id } };
    }
    default:
      return { error: "unknown_action" };
  }
}
