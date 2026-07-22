package app.telltea.npos.sell;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Frame-parity helpers for web {@code PosOptionPickerModal} / {@code pos-menu-cart.ts}.
 */
public final class OptionPickerLogic {
  public static final int MAX_UNITS_PER_CHOICE = 20;

  private static final Pattern PCT = Pattern.compile("(\\d+)\\s*%");

  private OptionPickerLogic() {}

  public static Integer parseSweetnessPercent(String name) {
    if (name == null) return null;
    String trimmed = name.trim();
    Matcher m = PCT.matcher(trimmed);
    if (m.find()) {
      try {
        return Integer.parseInt(m.group(1));
      } catch (Exception ignored) {
        return null;
      }
    }
    if (trimmed.matches("(?i)^(ไม่หวาน|ศูนย์|0\\s*%|zero).*")) return 0;
    return null;
  }

  public static boolean isSweetnessGroup(MenuModels.OptionGroup group) {
    if (group == null || group.name == null) return false;
    if (group.name.matches("(?i).*(ความหวาน|ระดับความหวาน|หวาน|sweet).*")) return true;
    if (group.options == null || group.options.size() < 2) return false;
    int withPct = 0;
    for (MenuModels.Option o : group.options) {
      if (parseSweetnessPercent(o.name) != null) withPct++;
    }
    return withPct >= Math.ceil(group.options.size() * 0.6);
  }

  /** multi/unlimited (not sweetness) → qty steppers per choice like web. */
  public static boolean usesQuantitySteppers(MenuModels.OptionGroup group) {
    if (group == null || isSweetnessGroup(group)) return false;
    if ("unlimited".equals(group.selectionType)) return true;
    if ("multi".equals(group.selectionType)) {
      int max = group.effectiveMax();
      return max > 1;
    }
    return false;
  }

  public static String groupHint(MenuModels.OptionGroup group) {
    if (group == null) return "";
    if (isSweetnessGroup(group)) return "เลือก 1 ระดับ";
    if (group.isSingle()) return "เลือก 1 อย่าง";
    if ("unlimited".equals(group.selectionType)) return "กด + เพิ่มได้หลายหน่วย";
    int max = group.effectiveMax();
    if (max > 1 && max < Integer.MAX_VALUE) {
      return String.format(Locale.getDefault(), "เลือกรวมไม่เกิน %d", max);
    }
    return "";
  }

  public static List<MenuModels.Option> sortForDisplay(MenuModels.OptionGroup group) {
    List<MenuModels.Option> out = new ArrayList<>();
    if (group == null || group.options == null) return out;
    out.addAll(group.options);
    if (isSweetnessGroup(group)) {
      out.sort(
          (a, b) -> {
            Integer pa = parseSweetnessPercent(a.name);
            Integer pb = parseSweetnessPercent(b.name);
            int va = pa == null ? 999 : pa;
            int vb = pb == null ? 999 : pb;
            return Integer.compare(va, vb);
          });
    } else {
      out.sort(
          (a, b) -> {
            int c = Double.compare(a.priceDelta, b.priceDelta);
            if (c != 0) return c;
            return a.name.compareTo(b.name);
          });
    }
    return out;
  }
}
