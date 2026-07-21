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
        public final List<Option> options;

        public OptionGroup(String id, String name, boolean required, List<Option> options) {
            this.id = id;
            this.name = name;
            this.required = required;
            this.options = options;
        }
    }

    public static final class Item {
        public final String id;
        public final String categoryId;
        public final String name;
        public final double price;
        public final List<String> optionGroupIds;

        public Item(
                String id, String categoryId, String name, double price, List<String> optionGroupIds) {
            this.id = id;
            this.categoryId = categoryId;
            this.name = name;
            this.price = price;
            this.optionGroupIds = optionGroupIds;
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

        public CartLine(String menuItemId, String name, double unitPrice, int qty, JSONArray optionsJson) {
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
        List<Item> items = new ArrayList<>();
        items.add(new Item("demo-tea", "demo-hot", "ชาเย็น", 45, new ArrayList<>()));
        items.add(new Item("demo-coffee", "demo-hot", "กาแฟเย็น", 50, new ArrayList<>()));
        items.add(new Item("demo-water", "demo-hot", "น้ำเปล่า", 10, new ArrayList<>()));
        items.add(new Item("demo-toast", "demo-food", "ขนมปังปิ้ง", 35, new ArrayList<>()));
        return new Bundle(cats, items, new ArrayList<>(), true, System.currentTimeMillis());
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
                                gids));
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
                                        op.optString("id"),
                                        op.optString("name"),
                                        op.optDouble("priceDelta", 0)));
                    }
                }
                groups.add(
                        new OptionGroup(
                                o.optString("id"),
                                o.optString("name"),
                                o.optBoolean("required", false),
                                opts));
            }
        }
        boolean demo = cats.isEmpty() || items.isEmpty();
        if (demo) return demoBundle();
        return new Bundle(cats, items, groups, false, root.optLong("fetchedAt", System.currentTimeMillis()));
    }
}
