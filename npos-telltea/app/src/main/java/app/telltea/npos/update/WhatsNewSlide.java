package app.telltea.npos.update;

/**
 * One page in the post-update "what's new" card.
 *
 * <p>{@code imageResId} is optional (0 = text-only). Keep copy short for the counter.
 */
public final class WhatsNewSlide {
  public final String title;
  public final String body;
  /** Drawable resource id, or 0 when no image. */
  public final int imageResId;

  public WhatsNewSlide(String title, String body) {
    this(title, body, 0);
  }

  public WhatsNewSlide(String title, String body, int imageResId) {
    this.title = title == null ? "" : title;
    this.body = body == null ? "" : body;
    this.imageResId = imageResId;
  }
}
