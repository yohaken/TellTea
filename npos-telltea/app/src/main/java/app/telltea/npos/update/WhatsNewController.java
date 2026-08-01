package app.telltea.npos.update;

import android.app.Activity;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.List;

import app.telltea.npos.R;
import app.telltea.npos.ui.NposFonts;
import app.telltea.npos.ui.NposUi;

/**
 * Compact swipeable "what's new" card — once per versionCode, always dismissible.
 *
 * <p>Does not block forced APK update. Never uses {@code AlertDialog.setItems}.
 */
public final class WhatsNewController {
  private static final int OVERLAY_ID = 0x50E11E01; // stable synthetic id
  private static final long SHOW_DELAY_MS = 450L;

  private final Activity activity;
  private final Handler main = new Handler(Looper.getMainLooper());
  private View overlay;
  private int pageIndex;
  private List<WhatsNewSlide> slides = java.util.Collections.emptyList();
  private TextView titleView;
  private TextView bodyView;
  private ImageView imageView;
  private TextView dotsView;
  private TextView primaryBtn;
  private int versionCode;
  private String versionName = "";

  private final Runnable showTask = this::showNow;

  public WhatsNewController(Activity activity) {
    this.activity = activity;
  }

  /** Schedule a show if this build has unseen slides and update popup is not up. */
  public void maybeShow() {
    main.removeCallbacks(showTask);
    versionCode = readVersionCode();
    versionName = readVersionName();
    if (!WhatsNewPrefs.shouldShow(activity, versionCode)) return;
    slides = WhatsNewCatalog.slidesFor(versionCode);
    if (slides.isEmpty()) {
      WhatsNewPrefs.markAck(activity, versionCode);
      return;
    }
    main.postDelayed(showTask, SHOW_DELAY_MS);
  }

  public void onPause() {
    main.removeCallbacks(showTask);
  }

  public void dismiss() {
    main.removeCallbacks(showTask);
    if (versionCode > 0) {
      WhatsNewPrefs.markAck(activity, versionCode);
    }
    removeOverlay();
  }

  public boolean isShowing() {
    return overlay != null && overlay.getParent() != null;
  }

  private void showNow() {
    if (activity.isFinishing()) return;
    if (isForcedUpdateVisible()) return;
    if (isShowing()) return;
    if (!WhatsNewPrefs.shouldShow(activity, versionCode)) return;
    pageIndex = 0;
    attachOverlay();
    renderPage();
  }

  private boolean isForcedUpdateVisible() {
    View update = activity.findViewById(R.id.updatePopup);
    return update != null && update.getVisibility() == View.VISIBLE;
  }

  private void attachOverlay() {
    ViewGroup root = activity.findViewById(android.R.id.content);
    if (!(root instanceof FrameLayout)) return;

    FrameLayout dim = new FrameLayout(activity);
    dim.setId(OVERLAY_ID);
    dim.setLayoutParams(
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    dim.setBackgroundColor(0x99000000);
    dim.setClickable(true);
    dim.setFocusable(true);
    // Tap outside card = dismiss (must always be escapable on the counter).
    dim.setOnClickListener(v -> dismiss());

    LinearLayout card = new LinearLayout(activity);
    card.setOrientation(LinearLayout.VERTICAL);
    card.setBackgroundResource(R.drawable.npos_popup_card);
    card.setElevation(NposUi.dp(activity, 12));
    int pad = NposUi.dp(activity, 16);
    card.setPadding(pad, pad, pad, pad);
    FrameLayout.LayoutParams cardLp =
        new FrameLayout.LayoutParams(NposUi.dp(activity, 300), ViewGroup.LayoutParams.WRAP_CONTENT);
    cardLp.gravity = Gravity.CENTER;
    card.setLayoutParams(cardLp);
    card.setClickable(true);
    card.setOnClickListener(v -> {}); // absorb — do not dismiss when tapping card

    LinearLayout head = new LinearLayout(activity);
    head.setOrientation(LinearLayout.HORIZONTAL);
    head.setGravity(Gravity.CENTER_VERTICAL);

    TextView eyebrow = NposUi.caption(activity, activity.getString(R.string.whats_new_title));
    eyebrow.setTypeface(NposFonts.semibold(activity));
    eyebrow.setTextColor(NposUi.color(activity, R.color.npos_orange));
    LinearLayout.LayoutParams eyeLp =
        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    eyebrow.setLayoutParams(eyeLp);

    TextView close = NposUi.ghost(activity, activity.getString(R.string.whats_new_close));
    close.setMinHeight(NposUi.dp(activity, 40));
    close.setOnClickListener(v -> dismiss());

    head.addView(eyebrow);
    head.addView(close);
    card.addView(head);

    TextView ver =
        NposUi.caption(
            activity, activity.getString(R.string.whats_new_version_fmt, versionName, versionCode));
    ver.setPadding(0, NposUi.dp(activity, 2), 0, NposUi.dp(activity, 8));
    card.addView(ver);

    // Swipe target = content only (buttons stay clickable).
    LinearLayout page = new LinearLayout(activity);
    page.setOrientation(LinearLayout.VERTICAL);
    page.setClickable(true);

    imageView = new ImageView(activity);
    imageView.setAdjustViewBounds(true);
    imageView.setScaleType(ImageView.ScaleType.CENTER_CROP);
    LinearLayout.LayoutParams imgLp =
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, NposUi.dp(activity, 120));
    imgLp.bottomMargin = NposUi.dp(activity, 8);
    imageView.setLayoutParams(imgLp);
    imageView.setVisibility(View.GONE);
    page.addView(imageView);

    titleView = NposUi.section(activity, "");
    titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f);
    page.addView(titleView);

    bodyView = NposUi.body(activity, "");
    bodyView.setPadding(0, NposUi.dp(activity, 4), 0, NposUi.dp(activity, 8));
    page.addView(bodyView);

    dotsView = NposUi.caption(activity, "");
    dotsView.setGravity(Gravity.CENTER);
    dotsView.setPadding(0, 0, 0, NposUi.dp(activity, 10));
    page.addView(dotsView);

    GestureDetector detector =
        new GestureDetector(
            activity,
            new GestureDetector.SimpleOnGestureListener() {
              private static final int MIN = 48;

              @Override
              public boolean onFling(
                  MotionEvent e1, MotionEvent e2, float velocityX, float velocityY) {
                if (e1 == null || e2 == null) return false;
                float dx = e2.getX() - e1.getX();
                if (Math.abs(dx) < MIN || Math.abs(velocityX) < 200) return false;
                if (dx < 0) nextPage();
                else prevPage();
                return true;
              }

              @Override
              public boolean onDown(MotionEvent e) {
                return true;
              }
            });
    page.setOnTouchListener((v, event) -> detector.onTouchEvent(event));
    card.addView(page);

    primaryBtn = NposUi.primary(activity, activity.getString(R.string.whats_new_got_it));
    primaryBtn.setLayoutParams(NposUi.cta(activity, 0));
    primaryBtn.setOnClickListener(v -> onPrimary());
    card.addView(primaryBtn);

    dim.addView(card);
    root.addView(dim);
    overlay = dim;
  }

  private void removeOverlay() {
    if (overlay == null) return;
    ViewGroup parent = (ViewGroup) overlay.getParent();
    if (parent != null) parent.removeView(overlay);
    overlay = null;
  }

  private void onPrimary() {
    if (pageIndex < slides.size() - 1) {
      nextPage();
    } else {
      dismiss();
    }
  }

  private void nextPage() {
    if (pageIndex >= slides.size() - 1) return;
    pageIndex++;
    renderPage();
  }

  private void prevPage() {
    if (pageIndex <= 0) return;
    pageIndex--;
    renderPage();
  }

  private void renderPage() {
    if (slides.isEmpty() || titleView == null) return;
    WhatsNewSlide slide = slides.get(Math.min(pageIndex, slides.size() - 1));
    titleView.setText(slide.title);
    bodyView.setText(slide.body);
    if (slide.imageResId != 0) {
      try {
        imageView.setImageResource(slide.imageResId);
        imageView.setVisibility(View.VISIBLE);
      } catch (RuntimeException e) {
        imageView.setVisibility(View.GONE);
      }
    } else {
      imageView.setImageDrawable(null);
      imageView.setVisibility(View.GONE);
    }
    dotsView.setText(buildDots(pageIndex, slides.size()));
    dotsView.setVisibility(slides.size() > 1 ? View.VISIBLE : View.GONE);
    boolean last = pageIndex >= slides.size() - 1;
    primaryBtn.setText(
        last
            ? activity.getString(R.string.whats_new_got_it)
            : activity.getString(R.string.whats_new_next));
  }

  private static String buildDots(int index, int total) {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < total; i++) {
      if (i > 0) sb.append(' ');
      sb.append(i == index ? '●' : '○');
    }
    return sb.toString();
  }

  private int readVersionCode() {
    try {
      PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
      if (Build.VERSION.SDK_INT >= 28) return (int) info.getLongVersionCode();
      return info.versionCode;
    } catch (Exception e) {
      return 0;
    }
  }

  private String readVersionName() {
    try {
      PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
      return info.versionName == null ? "" : info.versionName;
    } catch (Exception e) {
      return "";
    }
  }
}
