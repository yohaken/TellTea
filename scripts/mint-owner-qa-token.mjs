/**
 * One-shot: mint a short-lived Firebase custom token for owner QA login.
 * Requires FIREBASE_SERVICE_ACCOUNT JSON in env. Do not merge to main permanently.
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const admin = require("firebase-admin");

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT");
  process.exit(1);
}
const cred = JSON.parse(raw);
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(cred),
    projectId: cred.project_id,
  });
}

const email = (process.env.QA_OWNER_EMAIL || "yohaken@gmail.com").trim();
const user = await admin.auth().getUserByEmail(email);
const token = await admin.auth().createCustomToken(user.uid, { tellteaQa: true });
writeFileSync("qa-custom-token.txt", token, "utf8");
console.log(`minted custom token for ${email} uid=${user.uid} bytes=${token.length}`);
