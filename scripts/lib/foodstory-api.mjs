/**
 * FoodStory master API helpers (authenticated with access-token = idKey).
 * Endpoints reverse-engineered from manage.foodstory.co SPA bundle.
 */
export const FS_MASTER_BASE = "https://fs-api.foodstory.co/v1/master";
export const FS_IMAGES_BASE = "https://images.foodstory.co";
export const FS_MANAGE_MENU_URL = "https://manage.foodstory.co/th/menu";
export const FS_OWNER_LOGIN_URL = "https://owner.foodstory.co/login";

export function imageUrlFromKey(imageKey) {
  if (!imageKey || typeof imageKey !== "string") return "";
  const k = imageKey.trim();
  if (!k) return "";
  if (/^https?:\/\//i.test(k)) return k;
  if (k.startsWith("data:")) return k;
  return `${FS_IMAGES_BASE}/${k.replace(/^\//, "")}`;
}

/**
 * @param {{ idKey: string, branchId: string|number, fetchImpl?: typeof fetch }} opts
 */
export function createFoodstoryClient({ idKey, branchId, fetchImpl = fetch }) {
  if (!idKey) throw new Error("ต้องมี FoodStory idKey (access-token)");
  if (!branchId) throw new Error("ต้องมี FoodStory branchId");

  const branch = String(branchId);

  async function apiGet(path, query = {}) {
    const url = new URL(path.startsWith("http") ? path : `${FS_MASTER_BASE}${path}`);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
    const res = await fetchImpl(url, {
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
      json = { rawText: text.slice(0, 500) };
    }
    if (!res.ok) {
      const msg =
        (json && (json.message || json.error || json.msg)) ||
        `HTTP ${res.status} ${url.pathname}`;
      const err = new Error(String(msg));
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  async function listAll(resourcePath, { pageSize = 100, maxPages = 50, extraQuery = {} } = {}) {
    const rows = [];
    let page = 1;
    let pagesSeen = 0;
    while (pagesSeen < maxPages) {
      pagesSeen += 1;
      const data = await apiGet(`/branch/${branch}/${resourcePath}`, {
        page,
        pageSize,
        ...extraQuery,
      });
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

  return {
    branchId: branch,
    apiGet,
    listAll,
    async fetchCategories() {
      return listAll("category");
    },
    async fetchMenus(extraQuery = {}) {
      // active filter omitted → API default; caller may pass active/cateActive
      return listAll("menu", { extraQuery, pageSize: 100 });
    },
    async fetchOptions() {
      return listAll("option");
    },
    async fetchOptionListAll() {
      try {
        const data = await apiGet(`/branch/${branch}/option-list`);
        return extractList(data);
      } catch {
        return listAll("option");
      }
    },
    async fetchChoices() {
      return listAll("choice");
    },
    async fetchGroups() {
      return listAll("group");
    },
    async fetchMenuDetail(menuId) {
      return apiGet(`/branch/${branch}/menu/${menuId}`);
    },
  };
}

export function extractList(data) {
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
    "groups",
    "group_list",
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

export function extractTotal(data) {
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

export function extractEntity(data) {
  if (!data || typeof data !== "object") return data;
  if (data.data && typeof data.data === "object" && !Array.isArray(data.data)) return data.data;
  return data;
}
