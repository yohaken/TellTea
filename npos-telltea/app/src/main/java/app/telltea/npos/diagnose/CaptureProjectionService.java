package app.telltea.npos.diagnose;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import java.nio.ByteBuffer;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import app.telltea.npos.R;

/**
 * Holds MediaProjection in a mediaProjection FGS so BO can capture the real tablet screen.
 * One consent → keep projection until process death / user revoke.
 */
public final class CaptureProjectionService extends Service {
  public static final String ACTION_START = "app.telltea.npos.CAPTURE_PROJECTION_START";
  public static final String ACTION_STOP = "app.telltea.npos.CAPTURE_PROJECTION_STOP";
  public static final String EXTRA_RESULT_CODE = "resultCode";
  public static final String EXTRA_DATA = "data";

  private static final String CHANNEL = "npos_capture";
  private static final int NOTIF_ID = 7109;
  private static final Object LOCK = new Object();
  private static volatile CaptureProjectionService instance;

  private MediaProjection projection;
  private HandlerThread worker;
  private Handler workerHandler;
  private MediaProjection.Callback projectionCallback;

  public static boolean hasLiveProjection() {
    CaptureProjectionService svc = instance;
    return svc != null && svc.projection != null;
  }

  public static void startWithConsent(Context context, int resultCode, Intent data) {
    Intent i = new Intent(context, CaptureProjectionService.class);
    i.setAction(ACTION_START);
    i.putExtra(EXTRA_RESULT_CODE, resultCode);
    i.putExtra(EXTRA_DATA, data);
    if (Build.VERSION.SDK_INT >= 26) {
      context.startForegroundService(i);
    } else {
      context.startService(i);
    }
  }

  public static void stop(Context context) {
    Intent i = new Intent(context, CaptureProjectionService.class);
    i.setAction(ACTION_STOP);
    context.startService(i);
  }

  /** Grab one frame of the default display via VirtualDisplay. Null if not ready. */
  public static Bitmap grabPrimary(long timeoutMs) {
    CaptureProjectionService svc = instance;
    if (svc == null || svc.projection == null) return null;
    return svc.captureFrame(timeoutMs);
  }

  @Override
  public void onCreate() {
    super.onCreate();
    worker = new HandlerThread("npos-capture-proj");
    worker.start();
    workerHandler = new Handler(worker.getLooper());
    ensureChannel();
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent == null) {
      stopSelf();
      return START_NOT_STICKY;
    }
    String action = intent.getAction();
    if (ACTION_STOP.equals(action)) {
      teardown();
      stopForeground(true);
      stopSelf();
      return START_NOT_STICKY;
    }

    Notification notif = buildNotification();
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(
          NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
    } else {
      startForeground(NOTIF_ID, notif);
    }

    if (ACTION_START.equals(action)) {
      int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
      Intent data = readDataExtra(intent);
      if (data == null || resultCode == 0) {
        OpsLogger.warn(this, "display", "แคปจอ · ไม่มีผลอนุญาต", "result=" + resultCode);
        stopForeground(true);
        stopSelf();
        return START_NOT_STICKY;
      }
      bindProjection(resultCode, data);
    }

    return START_STICKY;
  }

  private void bindProjection(int resultCode, Intent data) {
    synchronized (LOCK) {
      teardownProjectionOnly();
      try {
        MediaProjectionManager mgr =
            (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        if (mgr == null) throw new IllegalStateException("no_media_projection_mgr");
        projection = mgr.getMediaProjection(resultCode, data);
        if (projection == null) throw new IllegalStateException("projection_null");
        projectionCallback =
            new MediaProjection.Callback() {
              @Override
              public void onStop() {
                OpsLogger.warn(
                    CaptureProjectionService.this, "display", "แคปจอ · ระบบถอนสิทธิ์", "");
                synchronized (LOCK) {
                  projection = null;
                }
                // Prefs said "granted" but token is dead — clear so next BO capture re-prompts.
                CaptureProjectionPrefs.markProjectionDead(CaptureProjectionService.this);
                stopForeground(true);
                stopSelf();
              }
            };
        projection.registerCallback(projectionCallback, workerHandler);
        instance = this;
        CaptureProjectionPrefs.markGranted(this);
        OpsLogger.info(
            this,
            "display",
            "แคปจอ · พร้อม MediaProjection",
            "live · api=" + Build.VERSION.SDK_INT);
      } catch (Exception e) {
        projection = null;
        OpsLogger.error(
            this,
            "display",
            "แคปจอ · เปิด MediaProjection ไม่สำเร็จ",
            e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
        stopForeground(true);
        stopSelf();
      }
    }
  }

  private Bitmap captureFrame(long timeoutMs) {
    CountDownLatch latch = new CountDownLatch(1);
    AtomicReference<Bitmap> out = new AtomicReference<>();
    AtomicReference<Exception> err = new AtomicReference<>();
    // Run off the MediaProjection callback HandlerThread. Polling+sleep on that same
    // looper used to starve ImageReader callbacks → permanent no_usable_frame.
    new Thread(
            () -> {
              try {
                MediaProjection proj;
                synchronized (LOCK) {
                  proj = projection;
                }
                if (proj == null) {
                  latch.countDown();
                  return;
                }
                DisplayMetrics metrics = new DisplayMetrics();
                WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
                if (wm != null && wm.getDefaultDisplay() != null) {
                  wm.getDefaultDisplay().getRealMetrics(metrics);
                }
                int width = Math.max(1, metrics.widthPixels);
                int height = Math.max(1, metrics.heightPixels);
                int dpi = Math.max(160, metrics.densityDpi);

                // Cap memory: still sharp for BO (matches ScreenCapture MAX_EDGE path later).
                int maxEdge = 1920;
                int edge = Math.max(width, height);
                if (edge > maxEdge) {
                  float s = maxEdge / (float) edge;
                  width = Math.max(1, Math.round(width * s));
                  height = Math.max(1, Math.round(height * s));
                }

                Bitmap chosen =
                    grabUsableFrame(proj, width, height, dpi, Math.max(1200L, timeoutMs));
                if (chosen == null && (width > 720 || height > 720)) {
                  // Some old POS firmwares only mirror smaller VirtualDisplays.
                  int hw = Math.max(1, width / 2);
                  int hh = Math.max(1, height / 2);
                  chosen = grabUsableFrame(proj, hw, hh, dpi, 1500L);
                }
                if (chosen == null) {
                  throw new IllegalStateException(
                      "no_usable_frame · api=" + Build.VERSION.SDK_INT);
                }
                out.set(chosen);
              } catch (Exception e) {
                err.set(e);
              } finally {
                latch.countDown();
              }
            },
            "npos-vd-grab")
        .start();
    try {
      if (!latch.await(timeoutMs + 2500L, TimeUnit.MILLISECONDS)) {
        return null;
      }
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return null;
    }
    if (err.get() != null) {
      OpsLogger.warn(
          this,
          "display",
          "แคปจอ · VirtualDisplay ล้ม",
          err.get().getMessage() == null ? "" : err.get().getMessage());
      return null;
    }
    return out.get();
  }

  /**
   * Create a VirtualDisplay and poll {@link ImageReader#acquireLatestImage()} on this thread.
   * Do not deliver ImageReader callbacks onto a Handler that this method blocks.
   */
  private Bitmap grabUsableFrame(
      MediaProjection proj, int width, int height, int dpi, long timeoutMs) {
    VirtualDisplay vd = null;
    ImageReader reader = null;
    try {
      reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 3);
      int flags =
          DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR
              | DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC;
      vd =
          proj.createVirtualDisplay(
              "npos-capture",
              width,
              height,
              dpi,
              flags,
              reader.getSurface(),
              null,
              null);

      // Let the mirror attach before polling.
      try {
        Thread.sleep(180L);
      } catch (InterruptedException ie) {
        Thread.currentThread().interrupt();
        return null;
      }

      long deadline =
          System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(Math.max(600L, timeoutMs));
      Bitmap chosen = null;
      int saw = 0;
      int rejected = 0;
      while (System.nanoTime() < deadline) {
        Image image = null;
        try {
          image = reader.acquireLatestImage();
          if (image != null) {
            saw++;
            Bitmap bmp = imageToBitmap(image);
            if (bmp != null) {
              if (!isMostlyBlackOrEmpty(bmp)) {
                chosen = bmp;
                break;
              }
              rejected++;
              bmp.recycle();
            }
          }
        } catch (Exception ignored) {
          /* keep polling */
        } finally {
          if (image != null) {
            try {
              image.close();
            } catch (Exception ignored) {
              /* ignore */
            }
          }
        }
        try {
          Thread.sleep(40L);
        } catch (InterruptedException ie) {
          Thread.currentThread().interrupt();
          break;
        }
      }
      if (chosen == null && saw > 0) {
        OpsLogger.warn(
            this,
            "display",
            "แคปจอ · เฟรม VirtualDisplay ใช้ไม่ได้",
            "saw=" + saw + " rejectBlack=" + rejected + " " + width + "x" + height);
      }
      return chosen;
    } catch (Exception e) {
      OpsLogger.warn(
          this,
          "display",
          "แคปจอ · สร้าง VirtualDisplay ไม่สำเร็จ",
          e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
      return null;
    } finally {
      if (vd != null) {
        try {
          vd.release();
        } catch (Exception ignored) {
          /* ignore */
        }
      }
      if (reader != null) {
        try {
          reader.close();
        } catch (Exception ignored) {
          /* ignore */
        }
      }
    }
  }

  /** Reject empty / first-frame black mirrors so we keep waiting for a real UI frame. */
  private static boolean isMostlyBlackOrEmpty(Bitmap bmp) {
    int w = bmp.getWidth();
    int h = bmp.getHeight();
    if (w < 8 || h < 8) return true;
    int samples = 0;
    int dark = 0;
    long sum = 0;
    long sumSq = 0;
    int stepX = Math.max(1, w / 12);
    int stepY = Math.max(1, h / 12);
    for (int y = stepY / 2; y < h; y += stepY) {
      for (int x = stepX / 2; x < w; x += stepX) {
        int c = bmp.getPixel(x, y);
        int r = (c >> 16) & 0xff;
        int g = (c >> 8) & 0xff;
        int b = c & 0xff;
        int yv = (r * 30 + g * 59 + b * 11) / 100;
        sum += yv;
        sumSq += (long) yv * yv;
        samples++;
        if (yv < 18) dark++;
      }
    }
    if (samples <= 0) return true;
    double mean = sum / (double) samples;
    double var = sumSq / (double) samples - mean * mean;
    return mean < 12.0 || (var < 25.0 && dark * 100 / samples >= 92);
  }

  private static Bitmap imageToBitmap(Image image) {
    Image.Plane[] planes = image.getPlanes();
    if (planes == null || planes.length == 0) return null;
    ByteBuffer buffer = planes[0].getBuffer();
    int pixelStride = planes[0].getPixelStride();
    int rowStride = planes[0].getRowStride();
    int width = image.getWidth();
    int height = image.getHeight();
    if (pixelStride <= 0) return null;
    int rowPadding = rowStride - pixelStride * width;
    Bitmap bitmap =
        Bitmap.createBitmap(
            width + Math.max(0, rowPadding / pixelStride), height, Bitmap.Config.ARGB_8888);
    buffer.rewind();
    bitmap.copyPixelsFromBuffer(buffer);
    if (rowPadding == 0) return bitmap;
    Bitmap cropped = Bitmap.createBitmap(bitmap, 0, 0, width, height);
    if (cropped != bitmap) bitmap.recycle();
    return cropped;
  }

  private void ensureChannel() {
    if (Build.VERSION.SDK_INT < 26) return;
    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    if (nm == null) return;
    NotificationChannel ch =
        new NotificationChannel(CHANNEL, "แคปจอหลังร้าน", NotificationManager.IMPORTANCE_LOW);
    ch.setDescription("เก็บสิทธิ์แคปจอให้สั่งจากหลังร้านได้");
    ch.setShowBadge(false);
    nm.createNotificationChannel(ch);
  }

  private Notification buildNotification() {
    Notification.Builder b;
    if (Build.VERSION.SDK_INT >= 26) {
      b = new Notification.Builder(this, CHANNEL);
    } else {
      b = new Notification.Builder(this);
    }
    return b.setContentTitle(getString(R.string.capture_projection_notif_title))
        .setContentText(getString(R.string.capture_projection_notif_body))
        .setSmallIcon(android.R.drawable.ic_menu_camera)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .build();
  }

  private void teardownProjectionOnly() {
    if (projection != null) {
      try {
        if (projectionCallback != null) {
          projection.unregisterCallback(projectionCallback);
        }
      } catch (Exception ignored) {
        /* ignore */
      }
      try {
        projection.stop();
      } catch (Exception ignored) {
        /* ignore */
      }
      projection = null;
      projectionCallback = null;
    }
  }

  private void teardown() {
    synchronized (LOCK) {
      if (instance == this) instance = null;
      teardownProjectionOnly();
    }
  }

  @Override
  public void onDestroy() {
    teardown();
    if (worker != null) {
      worker.quitSafely();
      worker = null;
      workerHandler = null;
    }
    super.onDestroy();
  }

  @SuppressWarnings("deprecation")
  private static Intent readDataExtra(Intent intent) {
    if (intent == null) return null;
    if (Build.VERSION.SDK_INT >= 33) {
      return intent.getParcelableExtra(EXTRA_DATA, Intent.class);
    }
    return intent.getParcelableExtra(EXTRA_DATA);
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
