/** Shopee ~15% max price change per save — compute next step toward target. */

export const MAX_STEP_PCT = 0.15;

/**
 * @returns {{ apply: number, reached: boolean, stepPct: number, stepsRemaining: number }}
 */
export function nextStepPrice(current, target, maxPct = MAX_STEP_PCT) {
  const cur = Math.round(Number(current));
  const tgt = Math.round(Number(target));
  if (!Number.isFinite(cur) || !Number.isFinite(tgt)) {
    throw new Error(`invalid price current=${current} target=${target}`);
  }
  if (cur === tgt) {
    return { apply: tgt, reached: true, stepPct: 0, stepsRemaining: 0 };
  }

  const diff = tgt - cur;
  const maxChange = Math.max(1, Math.round(cur * maxPct));
  let apply;
  if (Math.abs(diff) <= maxChange) {
    apply = tgt;
  } else {
    apply = cur + Math.sign(diff) * maxChange;
  }

  const stepPct = cur ? Math.abs(apply - cur) / cur : 0;
  let stepsRemaining = 0;
  if (apply !== tgt) {
    let sim = apply;
    while (sim !== tgt && stepsRemaining < 50) {
      const n = nextStepPrice(sim, tgt, maxPct);
      sim = n.apply;
      stepsRemaining += 1;
      if (n.reached) break;
    }
  }

  return { apply, reached: apply === tgt, stepPct, stepsRemaining };
}

export function diffPct(current, target) {
  const cur = Number(current);
  const tgt = Number(target);
  if (!cur || !Number.isFinite(cur) || !Number.isFinite(tgt)) return null;
  return Math.abs(tgt - cur) / cur;
}
