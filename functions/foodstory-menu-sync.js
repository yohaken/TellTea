/**
 * Owner callable: save FoodStory session + sync menu into Firestore (Admin SDK).
 * Actions: status | save_auth | sync
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");

const OWNER_EMAIL = String(process.env.TELLTEA_OWNER_EMAIL || "yohaken@gmail.com")
  .trim()
  .toLowerCase();
const FS_MASTER_BASE = "https://fs-api.foodstory.co/v1/master";
const FS_IMAGES_BASE = "https://images.foodstory.co";
const SOURCE = "foodstory";
const AUTH_DOC = "foodstoryAuth";
const SYNC_DOC = "foodstoryMenuSync";

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function asNumber(v, fallback = 0) {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

function asBoolFlag(v) {
  if (v === true || v === 1 || v === "1") return true;
  if (v === false || v === 0 || v === "0") return false;
  return null;
}

function pickId(row, keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]);
  }
  return "";
}

async function assertOwner(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบก่อน");
  }
  const email = asString(context.auth.token?.email, 120).toLowerCase();
  if (email && email === OWNER_EMAIL) {
    return { actorId: email };
  }
  const db = getFirestore();
  let staffId = email;
  if (!staffId) {
    const phone = asString(context.auth.token?.phone_number, 32);
    const digits = phone.startsWith("+") ? phone.slice(1) : phone;
    if (!digits) {
      throw new functions.https.HttpsError("permission-denied", "บัญชีนี้ไม่ใช่เจ้าของร้าน");
    }
    const phoneSnap = await db.collection("staffPhones").doc(digits).get();
    staffId = asString(phoneSnap.exists ? phoneSnap.get("staffId") : "", 120);
  }
  if (!staffId) {
    throw new functions.https.HttpsError("permission-denied", "บัญชีนี้ไม่ใช่เจ้าของร้าน");
  }
  const staffSnap = await db.collection("staff").doc(staffId).get();
  if (!staffSnap.exists || staffSnap.get("role") !== "owner") {
    throw new functions.https.HttpsError("permission-denied", "บัญชีนี้ไม่ใช่เจ้าของร้าน");
  }
  return { actorId: staffId };
}

function imageUrlFromKey(imageKey) {
  if (!imageKey || typeof imageKey !== "string") return "";
  const k = imageKey.trim();
  if (!k) return "";
  if (/^https?:\/\//i.test(k)) return k;
  return `${FS_IMAGES_BASE}/${k.replace(/^\//, "")}`;
}

function extractList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  for (const key of [
    "data",
    "items",
    "menus",
    "menu_list",
    "categories",
    "category_list",
    "options",
    "option_list",
    "choices",
    "choice_list",
    "rows",
    "result",
  ]) {
    const v = data[key];
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      for (const k2 of ["data", "items", "rows", "list"]) {
        if (Array.isArray(v[k2])) return v[k2];
      }
    }
  }
  return [];
}

function extractTotal(data) {
  if (!data || typeof data !== "object") return null;
  for (const key of ["total", "totalCount", "total_count", "count", "rowCount"]) {
    if (typeof data[key] === "number") return data[key];
  }
  if (data.data && typeof data.data === "object") {
    for (const key of ["total", "totalCount", "total_count", "count"]) {
      if (typeof data.data[key] === "number") return data.data[key];
    }
  }
  return null;
}

function extractEntity(data) {
  if (!data || typeof data !== "object") return data;
  if (data.data && typeof data.data === "object" && !Array.isArray(data.data)) return data.data;
  return data;
}

async function fsGet(idKey, path, query = {}) {
  const url = new URL(`${FS_MASTER_BASE}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json, text/plain, */*",
      "access-token": idKey,
      "x-lang": "th",
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { rawText: text.slice(0, 300) };
  }
  if (!res.ok) {
    const msg = (json && (json.message || json.error || json.msg)) || `HTTP ${res.status}`;
    const err = new Error(String(msg));
    err.status = res.status;
    throw err;
  }
  return json;
}

async function listAll(idKey, branchId, resource, pageSize = 100) {
  const rows = [];
  let page = 1;
  for (let i = 0; i < 50; i += 1) {
    const data = await fsGet(idKey, `/branch/${branchId}/${resource}`, { page, pageSize });
    const batch = extractList(data);
    rows.push(...batch);
    const total = extractTotal(data);
    if (!batch.length) break;
    if (total != null && rows.length >= total) break;
    if (batch.length < pageSize) break;
    page += 1;
  }
  return rows;
}

function mapSelection(requireFlag, minChoice, maxChoice) {
  const required = requireFlag === 1 || requireFlag === true || requireFlag === "1";
  const min = asNumber(minChoice, required ? 1 : 0);
  const max = asNumber(maxChoice, 1);
  if (max === 0) {
    return { required, selectionType: "unlimited", minSelect: required ? 1 : 0 };
  }
  if (max === 1) {
    return { required, selectionType: "single", minSelect: required ? 1 : 0, maxSelect: 1 };
  }
  return {
    required,
    selectionType: "multi",
    minSelect: required ? Math.max(1, min) : Math.max(0, min),
    maxSelect: max,
  };
}

function optionIdsFromMenuDetail(detail) {
  if (!detail || typeof detail !== "object") return [];
  const ids = [];
  const list = detail.option_list || detail.option_group_list || detail.options || [];
  if (!Array.isArray(list)) return [];
  for (const row of list) {
    if (typeof row === "string" || typeof row === "number") {
      ids.push(String(row));
      continue;
    }
    if (!row || typeof row !== "object") continue;
    if ("choose_flag" in row && !(row.choose_flag === true || row.choose_flag === 1 || row.choose_flag === "1")) {
      continue;
    }
    const id = pickId(row, ["option_id", "optionId", "option_group_id", "id"]);
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

function normalizeRaw(raw) {
  const categoriesIn = Array.isArray(raw.categories) ? raw.categories : [];
  const menusIn = Array.isArray(raw.menus) ? raw.menus : [];
  const optionsIn = Array.isArray(raw.options) ? raw.options : [];
  const choicesIn = Array.isArray(raw.choices) ? raw.choices : [];
  const details = raw.menuDetails && typeof raw.menuDetails === "object" ? raw.menuDetails : {};

  const categories = categoriesIn
    .map((row, i) => {
      const externalId = pickId(row, ["category_id", "categoryId", "id"]);
      if (!externalId) return null;
      const activeFlag = asBoolFlag(row.active ?? row.is_active ?? row.status);
      return {
        externalId,
        name: asString(row.category_name || row.name || row.categoryName, 80) || externalId,
        sortOrder: asNumber(row.sort_order ?? row.sortOrder ?? (i + 1) * 1000, (i + 1) * 1000),
        active: activeFlag == null ? true : activeFlag,
      };
    })
    .filter(Boolean);

  const catByName = new Map(categories.map((c) => [c.name, c.externalId]));

  const optionGroups = optionsIn
    .map((row, i) => {
      const externalId = pickId(row, ["option_id", "optionId", "id"]);
      if (!externalId) return null;
      const sel = mapSelection(row.require_flag ?? row.requireFlag, row.min_choice ?? row.minChoice, row.max_choice ?? row.maxChoice);
      const nested = Array.isArray(row.choice_list)
        ? row.choice_list
        : Array.isArray(row.choices)
          ? row.choices
          : choicesIn.filter((c) => pickId(c, ["option_id", "optionId", "mas_option_id", "option_group_id"]) === externalId);
      const options = nested
        .map((c, j) => {
          const cid = pickId(c, ["choice_id", "choiceId", "mas_choice_id", "id"]);
          const name = asString(c.choice_name || c.name || c.choiceName, 80);
          if (!cid || !name) return null;
          const activeFlag = asBoolFlag(c.active ?? c.is_active);
          return {
            externalId: cid,
            name,
            priceDelta: asNumber(c.price ?? c.price_delta ?? c.priceDelta, 0),
            sortOrder: asNumber(c.sort_order ?? c.sortOrder ?? (j + 1) * 100, (j + 1) * 100),
            active: activeFlag == null ? true : activeFlag,
          };
        })
        .filter(Boolean);
      const activeFlag = asBoolFlag(row.active ?? row.is_active);
      return {
        externalId,
        name: asString(row.option_name || row.name || row.optionName, 80) || externalId,
        ...sel,
        options,
        sortOrder: asNumber(row.sort_order ?? row.sortOrder ?? (i + 1) * 1000, (i + 1) * 1000),
        active: activeFlag == null ? true : activeFlag,
      };
    })
    .filter(Boolean);

  const items = menusIn
    .map((row, i) => {
      const externalId = pickId(row, ["menu_id", "menuId", "id"]);
      if (!externalId) return null;
      const name = asString(row.menu_name || row.name || row.menuName, 120);
      if (!name) return null;
      let categoryExternalId = pickId(row, ["category_id", "categoryId"]);
      const categoryName = asString(row.category_name || row.categoryName, 80);
      if (!categoryExternalId && categoryName && catByName.has(categoryName)) {
        categoryExternalId = catByName.get(categoryName);
      }
      const detail = details[externalId] || null;
      let optionGroupExternalIds = optionIdsFromMenuDetail(detail);
      if (!optionGroupExternalIds.length) optionGroupExternalIds = optionIdsFromMenuDetail(row);
      const activeFlag = asBoolFlag(row.active ?? row.is_active ?? row.menu_active);
      const imageKey = row.image_key || row.imageKey || row.image || "";
      return {
        externalId,
        categoryExternalId: categoryExternalId || "",
        categoryName: categoryName || undefined,
        name,
        nameEn: asString(row.menu_name2 || row.name_en || row.nameEn, 120) || undefined,
        description: asString(row.detail || row.description, 500) || undefined,
        price: asNumber(row.price, 0),
        imageUrl: imageUrlFromKey(imageKey) || undefined,
        imageKey: asString(imageKey, 240) || undefined,
        optionGroupExternalIds,
        sortOrder: asNumber(row.sort_order ?? row.sortOrder ?? (i + 1) * 100, (i + 1) * 100),
        active: activeFlag == null ? true : activeFlag,
        code: asString(row.code, 64) || undefined,
      };
    })
    .filter(Boolean);

  for (const item of items) {
    if (!item.categoryExternalId && item.categoryName) {
      const synId = `name:${item.categoryName}`;
      if (!categories.some((c) => c.externalId === synId || c.name === item.categoryName)) {
        categories.push({
          externalId: synId,
          name: item.categoryName,
          sortOrder: (categories.length + 1) * 1000,
          active: true,
        });
      }
      item.categoryExternalId =
        categories.find((c) => c.name === item.categoryName)?.externalId || synId;
    }
  }

  return {
    meta: {
      source: "foodstory-cf-sync",
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      branchId: raw.meta?.branchId || null,
      counts: {
        categories: categories.length,
        items: items.length,
        optionGroups: optionGroups.length,
        choices: optionGroups.reduce((n, g) => n + g.options.length, 0),
      },
    },
    categories,
    items,
    optionGroups,
  };
}

function isManual(data) {
  return data?.source === "manual";
}

function isFoodstory(data) {
  return data?.externalSource === SOURCE || data?.source === SOURCE;
}

function externalIdOf(data) {
  if (data?.externalId != null && String(data.externalId)) return String(data.externalId);
  return "";
}

function choiceIdFor(externalId, existingId) {
  if (existingId) return existingId;
  return `fs_c_${externalId}`;
}

function buildChoiceMap(existingGroup) {
  const byExt = new Map();
  const options = Array.isArray(existingGroup?.options) ? existingGroup.options : [];
  for (const o of options) {
    if (o?.externalId != null) byExt.set(String(o.externalId), o);
    else if (typeof o?.id === "string" && o.id.startsWith("fs_c_")) byExt.set(o.id.slice(5), o);
  }
  return byExt;
}

function planApply(snapshot, existing) {
  const now = Date.now();
  const plan = {
    categories: { create: [], update: [], delete: [] },
    optionGroups: { create: [], update: [], delete: [] },
    items: { create: [], update: [], delete: [] },
    orphans: { categories: [], optionGroups: [], items: [] },
    preservedManual: { categories: 0, optionGroups: 0, items: 0 },
  };
  const catByExt = new Map();
  const groupByExt = new Map();
  const itemByExt = new Map();

  for (const c of existing.categories) {
    if (isManual(c)) {
      plan.preservedManual.categories += 1;
      continue;
    }
    const ext = externalIdOf(c);
    if (isFoodstory(c) && ext) catByExt.set(ext, c);
    else plan.orphans.categories.push(c);
  }
  for (const g of existing.optionGroups) {
    if (isManual(g)) {
      plan.preservedManual.optionGroups += 1;
      continue;
    }
    const ext = externalIdOf(g);
    if (isFoodstory(g) && ext) groupByExt.set(ext, g);
    else plan.orphans.optionGroups.push(g);
  }
  for (const it of existing.items) {
    if (isManual(it)) {
      plan.preservedManual.items += 1;
      continue;
    }
    const ext = externalIdOf(it);
    if (isFoodstory(it) && ext) itemByExt.set(ext, it);
    else plan.orphans.items.push(it);
  }

  const catIdMap = new Map();
  const groupIdMap = new Map();

  for (const cat of snapshot.categories || []) {
    const ext = String(cat.externalId);
    const prev = catByExt.get(ext);
    const firestoreId = prev?.id || `fs_cat_${ext}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
    catIdMap.set(ext, firestoreId);
    const docData = {
      name: cat.name,
      sortOrder: typeof cat.sortOrder === "number" ? cat.sortOrder : 0,
      active: cat.active !== false,
      externalSource: SOURCE,
      externalId: ext,
      source: SOURCE,
      updatedAt: now,
      ...(prev ? {} : { createdAt: now }),
    };
    if (prev) plan.categories.update.push({ id: firestoreId, data: docData });
    else plan.categories.create.push({ id: firestoreId, data: docData });
    catByExt.delete(ext);
  }
  for (const [, prev] of catByExt) plan.categories.delete.push({ id: prev.id });

  for (const g of snapshot.optionGroups || []) {
    const ext = String(g.externalId);
    const prev = groupByExt.get(ext);
    const firestoreId = prev?.id || `fs_opt_${ext}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
    groupIdMap.set(ext, firestoreId);
    const prevChoices = buildChoiceMap(prev);
    const options = (g.options || []).map((o, i) => {
      const oExt = String(o.externalId);
      const prevO = prevChoices.get(oExt);
      return {
        id: choiceIdFor(oExt, prevO?.id),
        externalId: oExt,
        name: o.name,
        priceDelta: typeof o.priceDelta === "number" ? o.priceDelta : 0,
        sortOrder: typeof o.sortOrder === "number" ? o.sortOrder : (i + 1) * 100,
        active: o.active !== false,
      };
    });
    const docData = {
      name: g.name,
      required: g.required === true,
      selectionType: g.selectionType || "single",
      options,
      sortOrder: typeof g.sortOrder === "number" ? g.sortOrder : 0,
      active: g.active !== false,
      externalSource: SOURCE,
      externalId: ext,
      source: SOURCE,
      updatedAt: now,
      ...(prev ? {} : { createdAt: now }),
    };
    if (g.selectionType === "multi" || g.selectionType === "unlimited") {
      if (typeof g.minSelect === "number") docData.minSelect = g.minSelect;
      if (typeof g.maxSelect === "number") docData.maxSelect = g.maxSelect;
    } else if (g.required) {
      docData.minSelect = 1;
      docData.maxSelect = 1;
    }
    if (prev) plan.optionGroups.update.push({ id: firestoreId, data: docData });
    else plan.optionGroups.create.push({ id: firestoreId, data: docData });
    groupByExt.delete(ext);
  }
  for (const [, prev] of groupByExt) plan.optionGroups.delete.push({ id: prev.id });

  for (const item of snapshot.items || []) {
    const ext = String(item.externalId);
    const prev = itemByExt.get(ext);
    const firestoreId = prev?.id || `fs_item_${ext}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
    const categoryId = catIdMap.get(String(item.categoryExternalId)) || prev?.categoryId || "";
    const optionGroupIds = (item.optionGroupExternalIds || [])
      .map((gid) => groupIdMap.get(String(gid)))
      .filter(Boolean);
    const docData = {
      categoryId,
      name: item.name,
      price: typeof item.price === "number" ? item.price : 0,
      sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : 0,
      active: item.active !== false,
      visibleOnPos: prev?.visibleOnPos !== false,
      recommended: prev?.recommended === true,
      optionGroupIds,
      externalSource: SOURCE,
      externalId: ext,
      source: SOURCE,
      updatedAt: now,
      ...(prev ? {} : { createdAt: now }),
    };
    if (item.nameEn) docData.nameEn = item.nameEn;
    if (item.description) docData.description = item.description;
    if (item.code) docData.code = item.code;
    if (item.imageUrl) docData.imageUrl = item.imageUrl;
    else if (prev?.imageUrl) docData.imageUrl = prev.imageUrl;
    if (item.imageKey) docData.imageKey = item.imageKey;
    if (prev) plan.items.update.push({ id: firestoreId, data: docData });
    else plan.items.create.push({ id: firestoreId, data: docData });
    itemByExt.delete(ext);
  }
  for (const [, prev] of itemByExt) plan.items.delete.push({ id: prev.id });

  return { plan, now };
}

async function loadCol(db, name) {
  const snap = await db.collection(name).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function commitOps(db, ops) {
  let batch = db.batch();
  let n = 0;
  let commits = 0;
  for (const op of ops) {
    if (op.type === "set") batch.set(op.ref, op.data, { merge: true });
    else if (op.type === "delete") batch.delete(op.ref);
    n += 1;
    if (n >= 400) {
      await batch.commit();
      commits += 1;
      batch = db.batch();
      n = 0;
    }
  }
  if (n) {
    await batch.commit();
    commits += 1;
  }
  return commits;
}

async function fetchFoodstoryBundle(idKey, branchId) {
  const [categories, menus, options, choices] = await Promise.all([
    listAll(idKey, branchId, "category"),
    listAll(idKey, branchId, "menu"),
    listAll(idKey, branchId, "option").catch(async () => {
      const data = await fsGet(idKey, `/branch/${branchId}/option-list`);
      return extractList(data);
    }),
    listAll(idKey, branchId, "choice"),
  ]);

  const menuDetails = {};
  const ids = menus.map((m) => m.menu_id || m.menuId || m.id).filter((id) => id != null).map(String);
  let i = 0;
  const concurrency = 8;
  async function worker() {
    while (i < ids.length) {
      const idx = i;
      i += 1;
      const id = ids[idx];
      try {
        const raw = await fsGet(idKey, `/branch/${branchId}/menu/${id}`);
        menuDetails[id] = extractEntity(raw);
      } catch {
        // keep going — list may still carry option links
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return {
    meta: { branchId: String(branchId), capturedAt: new Date().toISOString() },
    categories,
    menus,
    options,
    choices,
    menuDetails,
  };
}

function summarizePlan(plan, keepOrphans) {
  return {
    categories: {
      create: plan.categories.create.length,
      update: plan.categories.update.length,
      delete: plan.categories.delete.length,
      orphanDelete: keepOrphans ? 0 : plan.orphans.categories.length,
    },
    optionGroups: {
      create: plan.optionGroups.create.length,
      update: plan.optionGroups.update.length,
      delete: plan.optionGroups.delete.length,
      orphanDelete: keepOrphans ? 0 : plan.orphans.optionGroups.length,
    },
    items: {
      create: plan.items.create.length,
      update: plan.items.update.length,
      delete: plan.items.delete.length,
      orphanDelete: keepOrphans ? 0 : plan.orphans.items.length,
    },
    preservedManual: plan.preservedManual,
  };
}

exports.foodstoryMenuSync = functions
  .region("asia-southeast1")
  .runWith({ memory: "1GB", timeoutSeconds: 300 })
  .https.onCall(async (data, context) => {
    const { actorId } = await assertOwner(context);
    const action = asString(data?.action, 32).toLowerCase() || "status";
    const db = getFirestore();

    if (action === "status") {
      const [authSnap, syncSnap] = await Promise.all([
        db.collection("meta").doc(AUTH_DOC).get(),
        db.collection("meta").doc(SYNC_DOC).get(),
      ]);
      const auth = authSnap.exists ? authSnap.data() : null;
      const sync = syncSnap.exists ? syncSnap.data() : null;
      return {
        ok: true,
        action,
        hasAuth: Boolean(auth?.idKey && auth?.branchId),
        branchId: auth?.branchId || null,
        authUpdatedAt: auth?.updatedAt || null,
        lastSync: sync || null,
      };
    }

    if (action === "save_auth") {
      const idKey = asString(data?.idKey, 2048);
      const branchId = asString(data?.branchId || data?.branch_id, 64);
      const companyId = asString(data?.companyId || data?.company_id, 64) || null;
      if (!idKey || idKey.length < 8) {
        throw new functions.https.HttpsError("invalid-argument", "ต้องมี idKey จาก FoodStory");
      }
      if (!branchId) {
        throw new functions.https.HttpsError("invalid-argument", "ต้องมี branchId");
      }
      const now = Date.now();
      await db.collection("meta").doc(AUTH_DOC).set(
        {
          idKey,
          branchId,
          companyId,
          updatedAt: now,
          updatedBy: actorId,
        },
        { merge: true },
      );
      return { ok: true, action, branchId, updatedAt: now };
    }

    if (action === "sync") {
      const dryRun = data?.dryRun === true;
      const keepOrphans = data?.keepOrphans === true;
      const authSnap = await db.collection("meta").doc(AUTH_DOC).get();
      let idKey = asString(data?.idKey, 2048) || asString(authSnap.get("idKey"), 2048);
      let branchId =
        asString(data?.branchId || data?.branch_id, 64) || asString(authSnap.get("branchId"), 64);
      if (!idKey || !branchId) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "ยังไม่มีเซสชัน FoodStory — บันทึก idKey/branchId ก่อน",
        );
      }

      let raw;
      try {
        raw = await fetchFoodstoryBundle(idKey, branchId);
      } catch (err) {
        const status = err?.status;
        throw new functions.https.HttpsError(
          status === 401 || status === 403 ? "unauthenticated" : "unavailable",
          `ดึงเมนู FoodStory ไม่สำเร็จ: ${err.message || err}`,
        );
      }

      const snapshot = normalizeRaw(raw);
      if (!snapshot.items.length) {
        throw new functions.https.HttpsError("not-found", "FoodStory ไม่มีเมนูในสาขานี้");
      }

      const existing = {
        categories: await loadCol(db, "menuCategories"),
        items: await loadCol(db, "menuItems"),
        optionGroups: await loadCol(db, "menuOptionGroups"),
      };
      const { plan, now } = planApply(snapshot, existing);
      const summary = summarizePlan(plan, keepOrphans);

      if (dryRun) {
        return {
          ok: true,
          action,
          dryRun: true,
          counts: snapshot.meta.counts,
          summary,
        };
      }

      const ops = [];
      const pushSet = (col, row) => ops.push({ type: "set", ref: db.collection(col).doc(row.id), data: row.data });
      const pushDel = (col, row) => ops.push({ type: "delete", ref: db.collection(col).doc(row.id) });

      for (const row of plan.categories.create) pushSet("menuCategories", row);
      for (const row of plan.categories.update) pushSet("menuCategories", row);
      for (const row of plan.optionGroups.create) pushSet("menuOptionGroups", row);
      for (const row of plan.optionGroups.update) pushSet("menuOptionGroups", row);
      for (const row of plan.items.create) pushSet("menuItems", row);
      for (const row of plan.items.update) pushSet("menuItems", row);
      for (const row of plan.items.delete) pushDel("menuItems", row);
      for (const row of plan.optionGroups.delete) pushDel("menuOptionGroups", row);
      for (const row of plan.categories.delete) pushDel("menuCategories", row);
      if (!keepOrphans) {
        for (const row of plan.orphans.items) pushDel("menuItems", row);
        for (const row of plan.orphans.optionGroups) pushDel("menuOptionGroups", row);
        for (const row of plan.orphans.categories) pushDel("menuCategories", row);
      }

      const commits = await commitOps(db, ops);
      await db.collection("meta").doc(SYNC_DOC).set(
        {
          lastAppliedAt: now,
          snapshotCapturedAt: snapshot.meta.capturedAt,
          branchId: String(branchId),
          counts: snapshot.meta.counts,
          summary,
          source: SOURCE,
          actorId,
          commits,
        },
        { merge: true },
      );
      await db.collection("meta").doc("pos").set(
        { menuVersion: now, menuSyncedAt: now, menuSource: SOURCE },
        { merge: true },
      );

      return {
        ok: true,
        action,
        dryRun: false,
        counts: snapshot.meta.counts,
        summary,
        commits,
        appliedAt: now,
      };
    }

    throw new functions.https.HttpsError("invalid-argument", `action ไม่รู้จัก: ${action}`);
  });
