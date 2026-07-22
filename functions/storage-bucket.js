/**
 * Resolve a usable GCS/Firebase Storage bucket.
 * Deploy historically wrote TELLTEA_STORAGE_BUCKET=*.firebasestorage.app even when
 * that bucket was never created — runtime must fall back to *.appspot.com.
 */
const { getStorage } = require("firebase-admin/storage");

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "mypeer-501909";

function candidateNames() {
  return [
    process.env.TELLTEA_STORAGE_BUCKET,
    process.env.TELLTEA_OT_STORAGE_BUCKET,
    // Prefer classic default — often the only bucket that already exists.
    `${PROJECT}.appspot.com`,
    `${PROJECT}.firebasestorage.app`,
  ].filter(Boolean);
}

let cachedName = "";

async function resolveStorageBucket() {
  if (cachedName) return getStorage().bucket(cachedName);
  const storage = getStorage();
  for (const name of candidateNames()) {
    try {
      const bucket = storage.bucket(name);
      const [exists] = await bucket.exists();
      if (exists) {
        cachedName = name;
        return bucket;
      }
    } catch (err) {
      console.warn("storage bucket probe failed", name, err?.message || err);
    }
  }
  // Last resort: Admin default (may still throw — caller surfaces error).
  try {
    const bucket = storage.bucket();
    cachedName = bucket.name || "";
    return bucket;
  } catch (err) {
    throw new Error(
      `no_storage_bucket (tried ${candidateNames().join(", ")}) — ${err?.message || err}`,
    );
  }
}

module.exports = { resolveStorageBucket, candidateNames };
