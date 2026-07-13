/** Promise ที่ไม่ resolve/reject ภายใน ms จะถูก reject — กัน UI ค้าง */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = "หมดเวลา"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(label));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** รอ promise แต่ไม่ throw — คืน fallback เมื่อหมดเวลา/พัง */
export async function settledWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  try {
    return await withTimeout(promise, ms);
  } catch {
    return fallback;
  }
}
