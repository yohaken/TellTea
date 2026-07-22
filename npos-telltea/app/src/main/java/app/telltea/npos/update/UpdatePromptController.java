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
import app.telltea.npos.ui.UiScale;

/**
 * Top-left update popup on sell/hub — check → one-tap install → resume sell after restart.
 */
public final class UpdatePromptController {
  public interface BeforeInstall {
    /** Persist cart / work so update restart feels seamless. */
    void onBeforeInstall();
  }

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
  private long lastCheckAt;
  private int localVersionCode = 1;

  public UpdatePromptController(Activity activity) {
    this.activity = activity;
    popup = activity.findViewById(R.id.updatePopup);
    body = activity.findViewById(R.id.updatePopupBody);
    progress = activity.findViewById(R.id.updatePopupProgress);
    goBtn = activity.findViewById(R.id.updatePopupGo);
    laterBtn = activity.findViewById(R.id.updatePopupLater);
    readLocalVersion();
    positionPopup();
    if (goBtn != null) goBtn.setOnClickListener(v -> onGo());
    if (laterBtn != null) {
      laterBtn.setOnClickListener(
          v -> {
            ResumePrefs.dismissPopupFor(activity, 30 * 60_000L);
            hide();
          });
    }
  }

  private void positionPopup() {
    if (popup == null) return;
    UiScale ui = UiScale.from(activity);
    ViewGroup.LayoutParams lp = popup.getLayoutParams();
    if (lp instanceof FrameLayout.LayoutParams) {
      FrameLayout.LayoutParams flp = (FrameLayout.LayoutParams) lp;
      View sidebar = activity.findViewById(R.id.posSidebar);
      int start = ui.dp(12);
      if (sidebar != null && sidebar.getVisibility() == View.VISIBLE) {
        start = ui.navWidthPx + ui.dp(12);
      }
      flp.setMarginStart(start);
      flp.topMargin = ui.dp(12);
      popup.setLayoutParams(flp);
    }
  }

  public void setBeforeInstall(BeforeInstall hook) {
    beforeInstall = hook;
  }

  public void onResume() {
    if (popup == null) return;
    if (ResumePrefs.isPopupDismissed(activity)) {
      hide();
      return;
    }
    long now = System.currentTimeMillis();
    if (now - lastCheckAt < UpdateConfig.AUTO_CHECK_MIN_INTERVAL_MS) return;
    lastCheckAt = now;
    startCheck();
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
      hide();
      return;
    }
    if (ResumePrefs.isPopupDismissed(activity)) {
      pending = manifest;
      return;
    }
    pending = manifest;
    if (body != null) {
      body.setText(
          activity.getString(
              R.string.update_popup_body, manifest.versionName, manifest.versionCode));
    }
    if (progress != null) progress.setVisibility(View.GONE);
    if (goBtn != null) {
      goBtn.setEnabled(true);
      goBtn.setText(R.string.btn_install_update);
    }
    if (laterBtn != null) laterBtn.setEnabled(true);
    if (popup != null) popup.setVisibility(View.VISIBLE);
  }

  private void onGo() {
    if (busy) return;
    if (pending == null || !pending.isNewerThan(localVersionCode)) {
      startCheck();
      return;
    }
    if (!ApkInstaller.canInstallPackages(activity)) {
      Toast.makeText(activity, R.string.status_allow_install, Toast.LENGTH_LONG).show();
      ApkInstaller.openUnknownSourcesSettings(activity);
      return;
    }
    busy = true;
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
                  if (laterBtn != null) laterBtn.setEnabled(true);
                  String msg =
                      error.getMessage() == null ? "download" : error.getMessage();
                  if (progress != null) {
                    progress.setVisibility(View.VISIBLE);
                    progress.setText(activity.getString(R.string.status_error, msg));
                  }
                  OpsLogger.error(activity, "update", "ดาวน์โหลดอัปเดตไม่สำเร็จ", msg);
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
          manifest.versionName + " (" + manifest.versionCode + ")");
      ApkInstaller.install(activity, apkFile);
      // Package replace kills process; ResumePrefs + InstallResultReceiver restart sell.
    } catch (Exception e) {
      busy = false;
      if (goBtn != null) goBtn.setEnabled(true);
      if (laterBtn != null) laterBtn.setEnabled(true);
      String msg = e.getMessage() == null ? "install" : e.getMessage();
      if (progress != null) progress.setText(activity.getString(R.string.status_error, msg));
      OpsLogger.error(activity, "update", "ติดตั้งอัปเดตไม่สำเร็จ", msg);
    }
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
