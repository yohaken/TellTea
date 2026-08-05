package app.telltea.npos.update;

import android.app.Activity;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;

import app.telltea.npos.BuildConfig;
import app.telltea.npos.R;
import app.telltea.npos.diagnose.OpsLogger;

/**
 * Forced APK update popup on sell/hub.
 *
 * <ul>
 *   <li>Always mandatory when a newer build is published — no Later / snooze.
 *   <li>Always force immediately — do not wait for idle cart / pay sheet.
 *   <li>Show forced popup + nag voice + open install permission if needed;
 *       auto-start download/install once permission is granted.
 * </ul>
 */
public final class UpdatePromptController {
  public interface BeforeInstall {
    /** Persist cart / work so update restart feels seamless. */
    void onBeforeInstall();
  }

  private static final long AUTO_INSTALL_DELAY_MS = 900L;
  private static final long PERMISSION_NUDGE_MS = 8_000L;

  private final Activity activity;
  private final View popup;
  private final TextView body;
  private final TextView progress;
  private final TextView goBtn;
  private final TextView laterBtn;
  private final UpdateChecker checker = new UpdateChecker();
  private final UpdateDownloader downloader = new UpdateDownloader();
  private final Handler main = new Handler(Looper.getMainLooper());
  private BeforeInstall beforeInstall;
  private UpdateManifest pending;
  private boolean busy;
  private boolean autoInstallScheduled;
  private boolean permissionSettingsOpened;
  private int localVersionCode = 1;

  private final Runnable autoInstallTask = this::maybeAutoInstall;
  /** Method-ref so field init does not read {@code activity} before the constructor assigns it. */
  private final Runnable permissionNudgeTask = this::runPermissionNudge;

  public UpdatePromptController(Activity activity) {
    this.activity = activity;
    popup = activity.findViewById(R.id.updatePopup);
    body = activity.findViewById(R.id.updatePopupBody);
    progress = activity.findViewById(R.id.updatePopupProgress);
    goBtn = activity.findViewById(R.id.updatePopupGo);
    laterBtn = activity.findViewById(R.id.updatePopupLater);
    readLocalVersion();
    positionPopup();
    // Mandatory update — never honor leftover snooze from older APKs.
    ResumePrefs.clearPopupDismiss(activity);
    if (goBtn != null) goBtn.setOnClickListener(v -> onGo());
    if (laterBtn != null) {
      // Hide "Later" — outdated APK must update; wrong-button must not silence popup.
      laterBtn.setVisibility(View.GONE);
      laterBtn.setOnClickListener(null);
    }
  }

  private void positionPopup() {
    if (popup == null) return;
    ViewGroup.LayoutParams lp = popup.getLayoutParams();
    if (lp instanceof FrameLayout.LayoutParams) {
      FrameLayout.LayoutParams flp = (FrameLayout.LayoutParams) lp;
      // Full-bleed dim overlay; compact card is centered inside the layout XML.
      flp.width = ViewGroup.LayoutParams.MATCH_PARENT;
      flp.height = ViewGroup.LayoutParams.MATCH_PARENT;
      flp.gravity = android.view.Gravity.CENTER;
      flp.setMargins(0, 0, 0, 0);
      flp.setMarginStart(0);
      flp.setMarginEnd(0);
      popup.setLayoutParams(flp);
    }
  }

  public void setBeforeInstall(BeforeInstall hook) {
    beforeInstall = hook;
  }

  public void onResume() {
    UpdateCheckCoordinator.bind(this);
    if (popup == null) return;
    ResumePrefs.clearPopupDismiss(activity);
    permissionSettingsOpened = false;
    if (hasPendingUpdate()) {
      showPending();
    }
    UpdateCheckCoordinator.requestCheck(activity, "resume");
  }

  /** Drop live host so background activities do not steal sync-pulse UI. */
  public void onPause() {
    UpdateCheckCoordinator.unbind(this);
    stopNag();
    main.removeCallbacks(autoInstallTask);
    main.removeCallbacks(permissionNudgeTask);
    autoInstallScheduled = false;
  }

  /** Claim / kick gate — poll sooner than sell auto-check. */
  public void forceCheck() {
    UpdateCheckCoordinator.resetThrottle();
    UpdateCheckCoordinator.bind(this);
    ResumePrefs.clearPopupDismiss(activity);
    if (popup == null) return;
    if (pending != null && pending.isNewerThan(localVersionCode)) {
      showPending();
      return;
    }
    UpdateCheckCoordinator.requestCheck(activity, "force");
  }

  boolean hasPendingUpdate() {
    return pending != null && pending.isNewerThan(localVersionCode);
  }

  /**
   * Sync pulse with a known newer build — always re-show (no snooze, no idle wait).
   */
  void reassertPendingUpdate() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      main.post(this::reassertPendingUpdate);
      return;
    }
    if (activity.isFinishing() || busy) return;
    if (!hasPendingUpdate()) return;
    ResumePrefs.clearPopupDismiss(activity);
    showPending();
  }

  /** Invoked by {@link UpdateCheckCoordinator} after throttle allows. */
  void runAutoCheck(String reason) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      main.post(() -> runAutoCheck(reason));
      return;
    }
    if (activity.isFinishing()) return;
    if (popup == null) return;
    ResumePrefs.clearPopupDismiss(activity);
    startCheck();
  }

  /** Expose local vs remote for claim-screen version chip. */
  public int localVersionCode() {
    return localVersionCode;
  }

  public void checkManifest(UpdateChecker.Callback callback) {
    String manifestUrl =
        BuildConfig.UPDATE_MANIFEST_URL == null || BuildConfig.UPDATE_MANIFEST_URL.isEmpty()
            ? UpdateConfig.MANIFEST_URL
            : BuildConfig.UPDATE_MANIFEST_URL;
    checker.check(manifestUrl, callback);
  }

  private void startCheck() {
    if (busy) return;
    String manifestUrl =
        BuildConfig.UPDATE_MANIFEST_URL == null || BuildConfig.UPDATE_MANIFEST_URL.isEmpty()
            ? UpdateConfig.MANIFEST_URL
            : BuildConfig.UPDATE_MANIFEST_URL;
    checker.check(
        manifestUrl,
        new UpdateChecker.Callback() {
          @Override
          public void onResult(UpdateManifest manifest) {
            main.post(() -> applyManifest(manifest));
          }

          @Override
          public void onError(Exception error) {
            /* silent on auto path */
          }
        });
  }

  private void applyManifest(UpdateManifest manifest) {
    if (manifest == null || !manifest.isNewerThan(localVersionCode)) {
      pending = null;
      stopNag();
      hide();
      return;
    }
    pending = manifest;
    ResumePrefs.clearPopupDismiss(activity);
    showPending();
  }

  private void showPending() {
    if (pending == null || !pending.isNewerThan(localVersionCode)) return;
    boolean canInstall = ApkInstaller.canInstallPackages(activity);
    if (body != null) {
      if (canInstall) {
        body.setText(
            activity.getString(
                R.string.update_popup_body_force, pending.versionName, pending.versionCode));
      } else {
        body.setText(
            activity.getString(
                R.string.update_popup_body_need_permission,
                pending.versionName,
                pending.versionCode));
      }
    }
    if (progress != null) progress.setVisibility(View.GONE);
    if (goBtn != null) {
      goBtn.setEnabled(true);
      goBtn.setText(
          canInstall ? R.string.btn_install_update : R.string.btn_allow_install_permission);
      // Make CTA hard to miss.
      goBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f);
    }
    if (laterBtn != null) {
      laterBtn.setVisibility(View.GONE);
      laterBtn.setEnabled(false);
    }
    if (popup != null) popup.setVisibility(View.VISIBLE);
    UpdateNagVoice.start(activity);
    OpsLogger.info(
        activity,
        "update",
        "บังคับอัปเดตทันที",
        pending.versionName
            + " ("
            + pending.versionCode
            + ")"
            + (canInstall ? "" : " · รอสิทธิ์ติดตั้ง"));

    if (!canInstall) {
      openInstallPermission();
      schedulePermissionNudge();
      return;
    }
    scheduleAutoInstall();
  }

  private void openInstallPermission() {
    if (permissionSettingsOpened) return;
    permissionSettingsOpened = true;
    try {
      Toast.makeText(activity, R.string.status_allow_install, Toast.LENGTH_LONG).show();
      ApkInstaller.openUnknownSourcesSettings(activity);
      OpsLogger.warn(activity, "update", "ขอสิทธิ์ติดตั้งอัปเดต", "unknown_sources");
    } catch (Exception e) {
      OpsLogger.error(
          activity,
          "update",
          "เปิดหน้าสิทธิ์ติดตั้งไม่สำเร็จ",
          e.getMessage() == null ? "" : e.getMessage());
    }
  }

  private void schedulePermissionNudge() {
    main.removeCallbacks(permissionNudgeTask);
    main.postDelayed(permissionNudgeTask, PERMISSION_NUDGE_MS);
  }

  private void runPermissionNudge() {
    if (activity == null || activity.isFinishing() || busy) return;
    if (!hasPendingUpdate()) return;
    if (ApkInstaller.canInstallPackages(activity)) {
      maybeAutoInstall();
      return;
    }
    // Staff returned from settings without grant — open again + keep nagging.
    openInstallPermission();
    schedulePermissionNudge();
  }

  private void scheduleAutoInstall() {
    if (autoInstallScheduled || busy) return;
    autoInstallScheduled = true;
    main.removeCallbacks(autoInstallTask);
    main.postDelayed(autoInstallTask, AUTO_INSTALL_DELAY_MS);
  }

  private void maybeAutoInstall() {
    autoInstallScheduled = false;
    if (activity.isFinishing() || busy) return;
    if (!hasPendingUpdate()) return;
    if (!ApkInstaller.canInstallPackages(activity)) {
      openInstallPermission();
      schedulePermissionNudge();
      return;
    }
    onGo();
  }

  private void onGo() {
    if (busy) return;
    if (pending == null || !pending.isNewerThan(localVersionCode)) {
      startCheck();
      return;
    }
    if (!ApkInstaller.canInstallPackages(activity)) {
      permissionSettingsOpened = false;
      openInstallPermission();
      schedulePermissionNudge();
      if (body != null) {
        body.setText(
            activity.getString(
                R.string.update_popup_body_need_permission,
                pending.versionName,
                pending.versionCode));
      }
      if (goBtn != null) goBtn.setText(R.string.btn_allow_install_permission);
      return;
    }
    busy = true;
    stopNag();
    main.removeCallbacks(autoInstallTask);
    main.removeCallbacks(permissionNudgeTask);
    if (goBtn != null) goBtn.setEnabled(false);
    if (laterBtn != null) laterBtn.setEnabled(false);
    if (progress != null) {
      progress.setVisibility(View.VISIBLE);
      progress.setText(activity.getString(R.string.status_downloading, 0));
    }
    try {
      if (beforeInstall != null) beforeInstall.onBeforeInstall();
    } catch (Exception ignored) {
      /* best effort */
    }
    ResumePrefs.markResumeSellAfterUpdate(activity);
    app.telltea.npos.diagnose.CaptureProjectionPrefs.markPromptAfterUpdate(activity);

    String apkUrl = pending.apkUrl;
    if (apkUrl == null || apkUrl.isEmpty()) apkUrl = BuildConfig.DEFAULT_APK_URL;
    final UpdateManifest manifest = pending;
    downloader.download(
        activity,
        apkUrl,
        new UpdateDownloader.Callback() {
          @Override
          public void onProgress(int percent) {
            main.post(
                () -> {
                  if (progress != null) {
                    progress.setText(activity.getString(R.string.status_downloading, percent));
                  }
                });
          }

          @Override
          public void onComplete(File apkFile) {
            main.post(() -> commitInstall(apkFile, manifest));
          }

          @Override
          public void onError(Exception error) {
            main.post(
                () -> {
                  busy = false;
                  if (goBtn != null) goBtn.setEnabled(true);
                  String msg =
                      error.getMessage() == null ? "download" : error.getMessage();
                  if (progress != null) {
                    progress.setVisibility(View.VISIBLE);
                    progress.setText(activity.getString(R.string.status_error, msg));
                  }
                  OpsLogger.error(activity, "update", "ดาวน์โหลดอัปเดตไม่สำเร็จ", msg);
                  // Keep forcing — retry.
                  UpdateNagVoice.start(activity);
                  scheduleAutoInstall();
                });
          }
        });
  }

  private void commitInstall(File apkFile, UpdateManifest manifest) {
    try {
      if (progress != null) {
        progress.setVisibility(View.VISIBLE);
        progress.setText(R.string.status_installing);
      }
      OpsLogger.info(
          activity,
          "update",
          "ติดตั้งอัปเดต",
          manifest.versionName);
      ApkInstaller.install(activity, apkFile);
      // Package replace kills process; ResumePrefs + InstallResultReceiver restart sell.
    } catch (Exception e) {
      busy = false;
      if (goBtn != null) goBtn.setEnabled(true);
      String msg = e.getMessage() == null ? "install" : e.getMessage();
      if (progress != null) progress.setText(activity.getString(R.string.status_error, msg));
      OpsLogger.error(activity, "update", "ติดตั้งอัปเดตไม่สำเร็จ", msg);
      UpdateNagVoice.start(activity);
      scheduleAutoInstall();
    }
  }

  private void stopNag() {
    UpdateNagVoice.stop();
  }

  private void hide() {
    if (popup != null) popup.setVisibility(View.GONE);
  }

  private void readLocalVersion() {
    try {
      PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
      if (Build.VERSION.SDK_INT >= 28) {
        localVersionCode = (int) info.getLongVersionCode();
      } else {
        localVersionCode = info.versionCode;
      }
    } catch (Exception ignored) {
      localVersionCode = BuildConfig.VERSION_CODE;
    }
  }
}
