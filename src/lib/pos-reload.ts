/** When POS must not reload (owner remote refresh or auto-update). */
export type PosSellBusyState = {
  cartCount: number;
  payOpen: boolean;
  saleBusy: boolean;
  pendingSyncCount: number;
};

export const POS_IDLE_BEFORE_RELOAD_MS = 8 * 1000;

export function isPosSafeToReload(state: PosSellBusyState): boolean {
  return (
    state.cartCount === 0 &&
    !state.payOpen &&
    !state.saleBusy &&
    state.pendingSyncCount === 0
  );
}
