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
                stopForeground(true);
                stopSelf();
              }
            };
        projection.registerCallback(projectionCallback, workerHandler);
        instance = this;
        CaptureProjectionPrefs.markGranted(this);
        OpsLogger.info(this, "display", "แคปจอ · พร้อม MediaProjection", "live");
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
    workerHandler.post(
        () -> {
          VirtualDisplay vd = null;
          ImageReader reader = null;
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

            reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
            final CountDownLatch frameLatch = new CountDownLatch(1);
            final AtomicReference<Image> latest = new AtomicReference<>();
            ImageReader.OnImageAvailableListener listener =
                r -> {
                  Image img = null;
                  try {
                    img = r.acquireLatestImage();
                    if (img != null) {
                      Image prev = latest.getAndSet(img);
                      if (prev != null) prev.close();
                      frameLatch.countDown();
                    }
                  } catch (Exception ignored) {
                    if (img != null) img.close();
                  }
                };
            reader.setOnImageAvailableListener(listener, workerHandler);

            vd =
                proj.createVirtualDisplay(
                    "npos-capture",
                    width,
                    height,
                    dpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    reader.getSurface(),
                    null,
                    workerHandler);

            if (!frameLatch.await(Math.max(800L, timeoutMs), TimeUnit.MILLISECONDS)) {
              throw new IllegalStateException("frame_timeout");
            }
            Image image = latest.getAndSet(null);
            if (image == null) throw new IllegalStateException("no_frame");
            try {
              out.set(imageToBitmap(image));
            } finally {
              image.close();
            }
          } catch (Exception e) {
            err.set(e);
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
                reader.setOnImageAvailableListener(null, null);
                reader.close();
              } catch (Exception ignored) {
                /* ignore */
              }
            }
            latch.countDown();
          }
        });
    try {
      if (!latch.await(timeoutMs + 1500L, TimeUnit.MILLISECONDS)) {
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

  private static Bitmap imageToBitmap(Image image) {
    Image.Plane[] planes = image.getPlanes();
    if (planes == null || planes.length == 0) return null;
    ByteBuffer buffer = planes[0].getBuffer();
    int pixelStride = planes[0].getPixelStride();
    int rowStride = planes[0].getRowStride();
    int width = image.getWidth();
    int height = image.getHeight();
    int rowPadding = rowStride - pixelStride * width;
    Bitmap bitmap =
        Bitmap.createBitmap(width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888);
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
