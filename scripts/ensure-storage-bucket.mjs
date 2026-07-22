/**
 * Ensure a Firebase/GCS bucket usable for OT product photos.
 * Prefer PROJECT.firebasestorage.app (modern Firebase default).
 * Avoid custom hosting domains that fail GCS domain-ownership checks.
 */
import { Storage } from "@google-cloud/storage";

const project =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
  "mypeer-501909";

const location = process.env.FIREBASE_STORAGE_LOCATION || "asia-southeast1";

const candidates = [
  process.env.TELLTEA_OT_STORAGE_BUCKET || "",
  // Classic Firebase default usually already exists in older projects.
  `${project}.appspot.com`,
  `${project}.firebasestorage.app`,
  `${project}-telltea-ot`,
].filter(Boolean);

function storageClient() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const creds = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    return new Storage({ projectId: project, credentials: creds });
  }
  return new Storage({ projectId: project });
}

async function ensureBucket(storage, bucketName) {
  const bucket = storage.bucket(bucketName);
  const [exists] = await bucket.exists();
  if (exists) {
    console.log(`OK storage bucket exists: gs://${bucketName}`);
    return true;
  }
  console.log(`Creating storage bucket gs://${bucketName} in ${location}...`);
  try {
    await storage.createBucket(bucketName, {
      location,
      uniformBucketLevelAccess: true,
    });
    console.log(`OK created gs://${bucketName}`);
    return true;
  } catch (err) {
    console.warn(`WARN create gs://${bucketName}: ${(err && err.message) || err}`);
    return false;
  }
}

async function main() {
  const storage = storageClient();
  for (const name of candidates) {
    // Skip obvious website domains — GCS treats them as verified-domain buckets.
    if (/\.(web\.app|firebaseapp\.com)$/i.test(name) && !/\.firebasestorage\.app$/i.test(name)) {
      console.warn(`SKIP website-like bucket name: ${name}`);
      continue;
    }
    if (await ensureBucket(storage, name)) {
      console.log(`TELLTEA_STORAGE_BUCKET=${name}`);
      return;
    }
  }
  console.error("Could not create or find a usable Storage bucket");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
