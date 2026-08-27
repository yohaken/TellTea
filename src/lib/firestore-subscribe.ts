import type { Query, QuerySnapshot, Unsubscribe } from "firebase/firestore";
import { getDocsFromServer, onSnapshot } from "firebase/firestore";

function isRetryableSubscribeError(err: unknown): boolean {
  const code = (err as { code?: string })?.code || "";
  const msg = err instanceof Error ? err.message : String(err);
  return (
    code === "permission-denied" ||
    /insufficient permissions|permission-denied|unavailable|network/i.test(msg)
  );
}

/** onSnapshot with short retry — กัน rules/auth ยังไม่พร้อมแล้วขึ้นแดงทั้งที่โหลดได้ภายหลัง */
export function subscribeQueryWithRetry<T>(
  buildQuery: () => Query<T>,
  onNext: (snap: QuerySnapshot<T>) => void,
  onError?: (err: Error) => void,
  opts?: { maxAttempts?: number; seedFromServer?: boolean },
): Unsubscribe {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const seedFromServer = opts?.seedFromServer === true;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let unsub: Unsubscribe = () => undefined;

  if (seedFromServer) {
    void getDocsFromServer(buildQuery())
      .then((snap) => {
        if (!stopped) onNext(snap);
      })
      .catch((err) => {
        if (stopped) return;
        const e = err instanceof Error ? err : new Error(String(err));
        onError?.(e);
      });
  }

  const start = (attempt = 0) => {
    if (stopped) return;
    unsub = onSnapshot(
      buildQuery(),
      (snap) => {
        if (stopped) return;
        // อย่าให้ cache เก่า (เคยเห็นแค่ 3 แถว) ทับยอด server ที่ครบ
        if (seedFromServer && snap.metadata.fromCache) return;
        onNext(snap);
      },
      (err) => {
        if (stopped) return;
        const e = err instanceof Error ? err : new Error(String(err));
        if (isRetryableSubscribeError(err) && attempt < maxAttempts) {
          unsub();
          retryTimer = setTimeout(() => start(attempt + 1), 1200 * (attempt + 1));
          return;
        }
        onError?.(e);
      },
    );
  };

  start();
  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    unsub();
  };
}
