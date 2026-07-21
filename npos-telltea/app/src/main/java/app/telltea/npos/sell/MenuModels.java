package app.telltea.npos.sell;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public final class MenuModels {
  private MenuModels() {}

  public static final class Category {
    public final String id;
    public final String name;

    public Category(String id, String name) {
      this.id = id;
      this.name = name;
    }
  }

  public static final class Option {
    public final String id;
    public final String name;
    public final double priceDelta;

    public Option(String id, String name, double priceDelta) {
      this.id = id;
      this.name = name;
      this.priceDelta = priceDelta;
    }
  }

  public static final class OptionGroup {
    public final String id;
    public final String name;
    public final boolean required;
    /** single | multi | unlimited — same as web POS. */
    public final String selectionType;
    public final List<Option> options;

    public OptionGroup(
        String id, String name, boolean required, String selectionType, List<Option> options) {
      this.id = id;
      this.name = name;
      this.required = required;
      this.selectionType =
          selectionType == null || selectionType.isEmpty() ? "single" : selectionType;
      this.options = options;
    }

    public boolean isSingle() {
      return !"multi".equals(selectionType) && !"unlimited".equals(selectionType);
    }
  }

  public static final class Item {
    public final String id;
    public final String categoryId;
    public final String name;
    public final double price;
    public final List<String> optionGroupIds;
    public final String imageUrl;
    /** false = sold out (ของหมด) — still shown on sell grid like web. */
    public final boolean active;

    public Item(
        String id,
        String categoryId,
        String name,
        double price,
        List<String> optionGroupIds,
        String imageUrl,
        boolean active) {
      this.id = id;
      this.categoryId = categoryId;
      this.name = name;
      this.price = price;
      this.optionGroupIds = optionGroupIds;
      this.imageUrl = imageUrl == null ? "" : imageUrl;
      this.active = active;
    }

    public boolean hasOptions() {
      return optionGroupIds != null && !optionGroupIds.isEmpty();
    }
  }

  public static final class Bundle {
    public final List<Category> categories;
    public final List<Item> items;
    public final List<OptionGroup> optionGroups;
    public final boolean demo;
    public final long fetchedAt;

    public Bundle(
        List<Category> categories,
        List<Item> items,
        List<OptionGroup> optionGroups,
        boolean demo,
        long fetchedAt) {
      this.categories = categories;
      this.items = items;
      this.optionGroups = optionGroups;
      this.demo = demo;
      this.fetchedAt = fetchedAt;
    }
  }

  public static final class CartLine {
    public final String menuItemId;
    public final String name;
    public final double unitPrice;
    public int qty;
    public final JSONArray optionsJson;

    public CartLine(
        String menuItemId, String name, double unitPrice, int qty, JSONArray optionsJson) {
      this.menuItemId = menuItemId;
      this.name = name;
      this.unitPrice = unitPrice;
      this.qty = qty;
      this.optionsJson = optionsJson == null ? new JSONArray() : optionsJson;
    }

    public double lineTotal() {
      return unitPrice * qty;
    }
  }

  public static Bundle demoBundle() {
    List<Category> cats = new ArrayList<>();
    cats.add(new Category("demo-hot", "เครื่องดื่ม"));
    cats.add(new Category("demo-food", "ของทานเล่น"));
    List<Option> sweetOpts = new ArrayList<>();
    sweetOpts.add(new Option("s0", "ไม่หวาน", 0));
    sweetOpts.add(new Option("s50", "หวาน 50%", 0));
    sweetOpts.add(new Option("s100", "หวานปกติ", 0));
    List<OptionGroup> groups = new ArrayList<>();
    groups.add(new OptionGroup("demo-sweet", "ความหวาน", true, "single", sweetOpts));
    List<String> teaGroups = new ArrayList<>();
    teaGroups.add("demo-sweet");
    List<Item> items = new ArrayList<>();
    items.add(new Item("demo-tea", "demo-hot", "ชาเย็น", 45, teaGroups, "", true));
    items.add(new Item("demo-coffee", "demo-hot", "กาแฟเย็น", 50, teaGroups, "", true));
    items.add(new Item("demo-water", "demo-hot", "น้ำเปล่า", 10, new ArrayList<>(), "", true));
    items.add(new Item("demo-toast", "demo-food", "ขนมปังปิ้ง", 35, new ArrayList<>(), "", true));
    return new Bundle(cats, items, groups, true, System.currentTimeMillis());
  }

  public static Bundle fromJson(JSONObject root) throws Exception {
    List<Category> cats = new ArrayList<>();
    JSONArray cArr = root.optJSONArray("categories");
    if (cArr != null) {
      for (int i = 0; i < cArr.length(); i++) {
        JSONObject o = cArr.getJSONObject(i);
        cats.add(new Category(o.optString("id"), o.optString("name")));
      }
    }
    List<Item> items = new ArrayList<>();
    JSONArray iArr = root.optJSONArray("items");
    if (iArr != null) {
      for (int i = 0; i < iArr.length(); i++) {
        JSONObject o = iArr.getJSONObject(i);
        List<String> gids = new ArrayList<>();
        JSONArray ga = o.optJSONArray("optionGroupIds");
        if (ga != null) {
          for (int j = 0; j < ga.length(); j++) gids.add(ga.optString(j));
        }
        items.add(
            new Item(
                o.optString("id"),
                o.optString("categoryId"),
                o.optString("name"),
                o.optDouble("price", 0),
                gids,
                o.optString("imageUrl", ""),
                o.optBoolean("active", true)));
      }
    }
    List<OptionGroup> groups = new ArrayList<>();
    JSONArray gArr = root.optJSONArray("optionGroups");
    if (gArr != null) {
      for (int i = 0; i < gArr.length(); i++) {
        JSONObject o = gArr.getJSONObject(i);
        List<Option> opts = new ArrayList<>();
        JSONArray oa = o.optJSONArray("options");
        if (oa != null) {
          for (int j = 0; j < oa.length(); j++) {
            JSONObject op = oa.getJSONObject(j);
            opts.add(
                new Option(
                    op.optString("id"), op.optString("name"), op.optDouble("priceDelta", 0)));
          }
        }
        groups.add(
            new OptionGroup(
                o.optString("id"),
                o.optString("name"),
                o.optBoolean("required", false),
                o.optString("selectionType", "single"),
                opts));
      }
    }
    boolean demo = cats.isEmpty() || items.isEmpty();
    if (demo) return demoBundle();
    return new Bundle(
        cats, items, groups, false, root.optLong("fetchedAt", System.currentTimeMillis()));
  }
}
