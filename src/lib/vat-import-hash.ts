/** Content hashing for VAT import dedupe (Storage inbox ↔ Firestore rows). */

export async function hashBytesSha256(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashFileSha256(file: Blob): Promise<string> {
  return hashBytesSha256(await file.arrayBuffer());
}
