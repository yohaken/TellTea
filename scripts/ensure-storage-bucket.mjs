/**
 * Ensure Firebase Storage default bucket exists so `firebase deploy --only storage` works.
 * Bucket name comes from NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET or `${project}.appspot.com`.
 */
import { readFileSync } from "node:fs";
import { Storage } from "@google-cloud/storage";

const project =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
  "mypeer-501909";

const bucketName = (
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
  `${project}.appspot.com`
).trim();

const location = process.env.FIREBASE_STORAGE_LOCATION || "asia-southeast1";

async function main() {
  if (!bucketName) {
    console.error("No storage bucket name");
    process.exit(1);
  }

  // Prefer explicit GOOGLE_APPLICATION_CREDENTIALS; firebase-admin JSON secret may be inlined.
  let storage;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const creds = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    storage = new Storage({ projectId: project, credentials: creds });
  } else {
    storage = new Storage({ projectId: project });
  }

  const bucket = storage.bucket(bucketName);
  const [exists] = await bucket.exists();
  if (exists) {
    console.log(`OK storage bucket exists: gs://${bucketName}`);
    return;
  }

  console.log(`Creating storage bucket gs://${bucketName} in ${location}...`);
  await storage.createBucket(bucketName, {
    location,
    uniformBucketLevelAccess: true,
    // Soft create — Firebase console also tags buckets; location is enough for deploy.
  });
  console.log(`OK created gs://${bucketName}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
