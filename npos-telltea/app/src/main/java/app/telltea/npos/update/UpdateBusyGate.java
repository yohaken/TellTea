package app.telltea.npos.update;

/**
 * Blocks forced install UI while a sale is in progress (cart / pay sheet).
 * Hub / idle screens return {@code false}.
 */
public interface UpdateBusyGate {
  /** {@code true} = do not show forced popup / do not install yet. */
  boolean blocksForceUpdate();
}
