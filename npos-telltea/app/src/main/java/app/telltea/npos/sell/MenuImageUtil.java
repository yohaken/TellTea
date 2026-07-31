package app.telltea.npos.sell;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * Center square-crop + JPEG encode to data URL — matches BOH 480px / ~0.82 quality caps.
 */
public final class MenuImageUtil {
  public static final int SQUARE_PX = 480;
  public static final int MAX_DATA_URL_CHARS = 900_000;

  private MenuImageUtil() {}

  public static String encodeSquareDataUrl(Context context, Uri uri) throws Exception {
    if (context == null || uri == null) throw new IllegalArgumentException("uri_required");
    int sample = sampleSizeFor(context, uri, 2048);
    Bitmap src;
    try (InputStream in = context.getContentResolver().openInputStream(uri)) {
      if (in == null) throw new IllegalStateException("เปิดไฟล์รูปไม่สำเร็จ");
      BitmapFactory.Options opts = new BitmapFactory.Options();
      opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
      opts.inSampleSize = sample;
      src = BitmapFactory.decodeStream(in, null, opts);
    }
    if (src == null) throw new IllegalStateException("อ่านรูปไม่สำเร็จ");
    try {
      Bitmap square = centerSquare(src, SQUARE_PX);
      try {
        return toJpegDataUrl(square);
      } finally {
        if (square != src && !square.isRecycled()) square.recycle();
      }
    } finally {
      if (!src.isRecycled()) src.recycle();
    }
  }

  private static int sampleSizeFor(Context context, Uri uri, int maxEdge) {
    try (InputStream in = context.getContentResolver().openInputStream(uri)) {
      if (in == null) return 1;
      BitmapFactory.Options bounds = new BitmapFactory.Options();
      bounds.inJustDecodeBounds = true;
      BitmapFactory.decodeStream(in, null, bounds);
      int w = Math.max(1, bounds.outWidth);
      int h = Math.max(1, bounds.outHeight);
      int sample = 1;
      while (Math.max(w / sample, h / sample) > maxEdge) sample *= 2;
      return Math.max(1, sample);
    } catch (Exception e) {
      return 2;
    }
  }

  static Bitmap centerSquare(Bitmap src, int outPx) {
    int side = Math.min(src.getWidth(), src.getHeight());
    int x = (src.getWidth() - side) / 2;
    int y = (src.getHeight() - side) / 2;
    Bitmap cropped = Bitmap.createBitmap(src, x, y, side, side);
    if (side == outPx) return cropped;
    Bitmap scaled = Bitmap.createScaledBitmap(cropped, outPx, outPx, true);
    if (cropped != src && cropped != scaled && !cropped.isRecycled()) cropped.recycle();
    return scaled;
  }

  static String toJpegDataUrl(Bitmap bmp) throws Exception {
    float quality = 0.82f;
    String dataUrl = encode(bmp, quality);
    while (dataUrl.length() > MAX_DATA_URL_CHARS && quality > 0.45f) {
      quality -= 0.08f;
      dataUrl = encode(bmp, quality);
    }
    if (dataUrl.length() > MAX_DATA_URL_CHARS) {
      throw new IllegalStateException("รูปยังใหญ่เกินไปหลังบีบอัด");
    }
    return dataUrl;
  }

  private static String encode(Bitmap bmp, float quality) {
    ByteArrayOutputStream bos = new ByteArrayOutputStream();
    bmp.compress(Bitmap.CompressFormat.JPEG, Math.round(quality * 100f), bos);
    String b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
    return "data:image/jpeg;base64," + b64;
  }
}
