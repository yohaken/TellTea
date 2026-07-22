package app.telltea.npos.sell;

import android.graphics.Bitmap;
import android.graphics.Color;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;

import java.util.EnumMap;
import java.util.Map;

/** Offline QR bitmap — no network (PromptPay pay sheet). */
public final class QrBitmaps {
  private QrBitmaps() {}

  public static Bitmap encode(String data, int sizePx) {
    if (data == null || data.isEmpty() || sizePx <= 0) return null;
    try {
      Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
      hints.put(EncodeHintType.CHARACTER_SET, "UTF-8");
      hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M);
      hints.put(EncodeHintType.MARGIN, 1);
      BitMatrix matrix =
          new QRCodeWriter().encode(data, BarcodeFormat.QR_CODE, sizePx, sizePx, hints);
      int w = matrix.getWidth();
      int h = matrix.getHeight();
      Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
      for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
          bmp.setPixel(x, y, matrix.get(x, y) ? Color.BLACK : Color.WHITE);
        }
      }
      return bmp;
    } catch (Exception e) {
      return null;
    }
  }
}
