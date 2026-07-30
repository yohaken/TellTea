package app.telltea.npos.diagnose;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Splits integer baht into bundled clip keys (see {@code res/raw/voice_*.mp3}).
 * Enough for typical POS cash (0 … 9_999_999).
 */
public final class ThaiCashWords {
  private static final String[] DIGIT = {
    "sun", "nueng", "song", "sam", "si", "ha", "hok", "jet", "paed", "kao"
  };

  private ThaiCashWords() {}

  /** Clip keys without {@code voice_} prefix, e.g. {@code nueng}, {@code roi}. */
  public static List<String> keysForBaht(long amount) {
    if (amount <= 0) return Collections.singletonList("sun");
    if (amount > 9_999_999L) amount = 9_999_999L;
    List<String> out = new ArrayList<>();
    long lan = amount / 1_000_000L;
    if (lan > 0) {
      appendBelowMillion(out, lan, false);
      out.add("lan");
      amount %= 1_000_000L;
    }
    if (amount > 0 || out.isEmpty()) {
      appendBelowMillion(out, amount, !out.isEmpty());
    }
    return out;
  }

  private static void appendBelowMillion(List<String> out, long n, boolean afterHigher) {
    if (n <= 0) {
      if (!afterHigher) out.add("sun");
      return;
    }
    int saen = (int) (n / 100_000L);
    int muen = (int) ((n / 10_000L) % 10);
    int phan = (int) ((n / 1_000L) % 10);
    int roi = (int) ((n / 100L) % 10);
    int rest = (int) (n % 100L);

    boolean higher = afterHigher;
    if (saen > 0) {
      out.add(DIGIT[saen]);
      out.add("saen");
      higher = true;
    }
    if (muen > 0) {
      out.add(DIGIT[muen]);
      out.add("muen");
      higher = true;
    }
    if (phan > 0) {
      out.add(DIGIT[phan]);
      out.add("phan");
      higher = true;
    }
    if (roi > 0) {
      out.add(DIGIT[roi]);
      out.add("roi");
      higher = true;
    }
    appendTensOnes(out, rest, higher);
  }

  private static void appendTensOnes(List<String> out, int n, boolean afterHigher) {
    if (n <= 0) return;
    int tens = n / 10;
    int ones = n % 10;
    if (tens == 0) {
      if (ones == 1 && afterHigher) out.add("et");
      else out.add(DIGIT[ones]);
      return;
    }
    if (tens == 1) {
      out.add("sip");
    } else if (tens == 2) {
      out.add("yi");
      out.add("sip");
    } else {
      out.add(DIGIT[tens]);
      out.add("sip");
    }
    if (ones == 1) out.add("et");
    else if (ones > 1) out.add(DIGIT[ones]);
  }
}
