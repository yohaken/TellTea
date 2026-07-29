/** Content hashing for VAT import dedupe (Storage inbox ↔ Firestore rows). */

function toDigestSource(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function hashBytesSha256(
  bytes: ArrayBuffer | Uint8Array,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toDigestSource(bytes));
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function hashFileSha256(file: Blob): Promise<string> {
  return hashBytesSha256(await file.arrayBuffer());
}
