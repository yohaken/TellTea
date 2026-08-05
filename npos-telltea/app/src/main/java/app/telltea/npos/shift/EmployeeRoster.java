package app.telltea.npos.shift;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Active employee names from shop settings cache (nposShopSettings.employees).
 * Used only for clock-in name picker — not linked to OT shift table.
 */
public final class EmployeeRoster {
  public static final class Person {
    public final String id;
    public final String name;
    public final String nickname;

    public Person(String id, String name, String nickname) {
      this.id = id == null ? "" : id;
      this.name = name == null ? "" : name;
      this.nickname = nickname == null ? "" : nickname;
    }

    /** Label on picker chips. */
    public String label() {
      if (!nickname.isEmpty() && !nickname.equalsIgnoreCase(name)) {
        return name + " (" + nickname + ")";
      }
      return name;
    }
  }

  private EmployeeRoster() {}

  public static List<Person> load(Context context) {
    List<Person> out = new ArrayList<>();
    if (context == null) return out;
    try {
      String raw =
          context
              .getApplicationContext()
              .getSharedPreferences("npos_menu", Context.MODE_PRIVATE)
              .getString("shopJson", "{}");
      JSONObject shop = new JSONObject(raw == null || raw.isEmpty() ? "{}" : raw);
      JSONArray arr = shop.optJSONArray("employees");
      if (arr == null) return out;
      for (int i = 0; i < arr.length(); i++) {
        JSONObject row = arr.optJSONObject(i);
        if (row == null) continue;
        String name = row.optString("name", "").trim();
        if (name.isEmpty()) continue;
        out.add(
            new Person(
                row.optString("id", "").trim(),
                name,
                row.optString("nickname", "").trim()));
      }
    } catch (Exception ignored) {
      /* empty roster — opener UI blocks until shop employees sync */
    }
    return out;
  }
}
