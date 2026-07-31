package app.telltea.npos;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import app.telltea.npos.sell.MenuModels;
import app.telltea.npos.sell.MenuRepository;
import app.telltea.npos.shift.ShiftPrefs;
import app.telltea.npos.ui.NposConfirmDialog;
import app.telltea.npos.ui.NposFonts;
import app.telltea.npos.ui.NposUi;

/** Edit option group + choices — BOH PosOptionGroupEditor parity (compact table). */
public class MenuGroupEditActivity extends Activity {
  public static final String EXTRA_GROUP_ID = "groupId";

  private final MenuRepository menuRepo = new MenuRepository();
  private String groupId = "";
  private MenuModels.Bundle menu;
  private boolean busy;
  private boolean required;
  private String selectionType = "single";
  private final List<ChoiceRow> choices = new ArrayList<>();

  private EditText nameField;
  private TextView statusLine;
  private TextView requiredChip;
  private TextView selSingle;
  private TextView selMulti;
  private TextView selUnlimited;
  private LinearLayout choicesBox;
  private TextView saveBtn;

  private static final class ChoiceRow {
    String id;
    String name;
    double priceDelta;
    double deliveryPriceDelta;
    boolean active = true;
    EditText nameEd;
    EditText priceEd;
    EditText deliveryEd;
  }

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (!ShiftPrefs.isOpen(this)) {
      Toast.makeText(this, R.string.menu_admin_need_shift, Toast.LENGTH_LONG).show();
      finish();
      return;
    }
    NposFonts.applyActivity(this);
    Intent in = getIntent();
    if (in != null) {
      groupId = in.getStringExtra(EXTRA_GROUP_ID);
      if (groupId == null) groupId = "";
    }

    LinearLayout page = new LinearLayout(this);
    page.setOrientation(LinearLayout.VERTICAL);
    page.setBackgroundColor(NposUi.color(this, R.color.npos_bg));
    int pad = NposUi.dp(this, 12);
    page.setPadding(pad, pad, pad, pad);
    page.addView(NposUi.headerBar(this, getString(R.string.menu_group_edit_title)));

    statusLine = NposUi.caption(this, getString(R.string.sell_loading_menu));
    statusLine.setPadding(0, 0, 0, NposUi.dp(this, 8));
    page.addView(statusLine);

    ScrollView scroll = new ScrollView(this);
    scroll.setLayoutParams(
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
    LinearLayout form = new LinearLayout(this);
    form.setOrientation(LinearLayout.VERTICAL);
    scroll.addView(form);
    page.addView(scroll);

    form.addView(label(R.string.menu_admin_col_name));
    nameField = NposUi.field(this);
    nameField.setLayoutParams(NposUi.matchWidth(this, 8));
    form.addView(nameField);

    form.addView(label(R.string.menu_group_rules));
    LinearLayout flags = new LinearLayout(this);
    flags.setOrientation(LinearLayout.HORIZONTAL);
    requiredChip = NposUi.chip(this, getString(R.string.menu_admin_required));
    requiredChip.setOnClickListener(
        v -> {
          required = !required;
          paintFlags();
        });
    flags.addView(requiredChip);
    form.addView(flags);

    LinearLayout selRow = new LinearLayout(this);
    selRow.setOrientation(LinearLayout.HORIZONTAL);
    selSingle = NposUi.chip(this, getString(R.string.menu_admin_sel_single));
    selMulti = NposUi.chip(this, getString(R.string.menu_admin_sel_multi));
    selUnlimited = NposUi.chip(this, getString(R.string.menu_admin_sel_unlimited));
    selSingle.setOnClickListener(
        v -> {
          selectionType = "single";
          paintFlags();
        });
    selMulti.setOnClickListener(
        v -> {
          selectionType = "multi";
          paintFlags();
        });
    selUnlimited.setOnClickListener(
        v -> {
          selectionType = "unlimited";
          paintFlags();
        });
    selSingle.setLayoutParams(NposUi.wrap(this, 8, 8));
    selMulti.setLayoutParams(NposUi.wrap(this, 8, 8));
    selUnlimited.setLayoutParams(NposUi.wrap(this, 0, 8));
    selRow.addView(selSingle);
    selRow.addView(selMulti);
    selRow.addView(selUnlimited);
    form.addView(selRow);

    form.addView(label(R.string.menu_group_choices));
    choicesBox = new LinearLayout(this);
    choicesBox.setOrientation(LinearLayout.VERTICAL);
    form.addView(choicesBox);

    TextView addChoice = NposUi.secondary(this, getString(R.string.menu_group_add_choice));
    addChoice.setLayoutParams(NposUi.cta(this, 10));
    addChoice.setOnClickListener(
        v -> {
          ChoiceRow row = new ChoiceRow();
          row.id = "c_" + System.currentTimeMillis();
          row.name = "";
          choices.add(row);
          paintChoices();
        });
    form.addView(addChoice);

    saveBtn = NposUi.primary(this, getString(R.string.menu_item_save));
    saveBtn.setMaxWidth(Integer.MAX_VALUE);
    saveBtn.setLayoutParams(NposUi.matchWidth(this, 8));
    saveBtn.setOnClickListener(v -> save());
    form.addView(saveBtn);

    if (!groupId.isEmpty()) {
      TextView archive = NposUi.secondary(this, getString(R.string.menu_group_archive));
      archive.setMaxWidth(Integer.MAX_VALUE);
      archive.setLayoutParams(NposUi.matchWidth(this, 8));
      archive.setOnClickListener(v -> confirmArchive());
      form.addView(archive);
    }

    setContentView(page);
    reload();
  }

  @Override
  protected void onDestroy() {
    menuRepo.shutdown();
    super.onDestroy();
  }

  private TextView label(int res) {
    TextView tv = NposUi.caption(this, getString(res));
    tv.setPadding(0, NposUi.dp(this, 8), 0, NposUi.dp(this, 4));
    tv.setTypeface(NposFonts.semibold(this));
    return tv;
  }

  private void reload() {
    menuRepo.loadAdminMenu(
        this,
        bundle ->
            runOnUiThread(
                () -> {
                  if (isFinishing()) return;
                  menu = bundle;
                  if (bundle.demo) {
                    statusLine.setText(R.string.menu_admin_demo_banner);
                    saveBtn.setEnabled(false);
                    return;
                  }
                  statusLine.setText(R.string.menu_admin_ready_edit);
                  bindGroup();
                  paintFlags();
                  paintChoices();
                }));
  }

  private void bindGroup() {
    if (groupId.isEmpty() || menu == null) {
      if (choices.isEmpty()) {
        ChoiceRow row = new ChoiceRow();
        row.id = "c_" + System.currentTimeMillis();
        row.name = "ไม่รับ";
        choices.add(row);
      }
      return;
    }
    MenuModels.OptionGroup g = findGroup(groupId);
    if (g == null) {
      statusLine.setText(R.string.menu_group_missing);
      return;
    }
    nameField.setText(g.name);
    required = g.required;
    selectionType = g.selectionType;
    choices.clear();
    if (g.options != null) {
      for (MenuModels.Option o : g.options) {
        ChoiceRow row = new ChoiceRow();
        row.id = o.id;
        row.name = o.name;
        row.priceDelta = o.priceDelta;
        row.deliveryPriceDelta = o.deliveryPriceDelta;
        row.active = o.active;
        choices.add(row);
      }
    }
  }

  private void paintFlags() {
    NposUi.applyBtn(requiredChip, required ? NposUi.Btn.CHIP_PRIMARY : NposUi.Btn.CHIP);
    NposUi.applyBtn(selSingle, "single".equals(selectionType) ? NposUi.Btn.CHIP_PRIMARY : NposUi.Btn.CHIP);
    NposUi.applyBtn(selMulti, "multi".equals(selectionType) ? NposUi.Btn.CHIP_PRIMARY : NposUi.Btn.CHIP);
    NposUi.applyBtn(
        selUnlimited, "unlimited".equals(selectionType) ? NposUi.Btn.CHIP_PRIMARY : NposUi.Btn.CHIP);
  }

  private void paintChoices() {
    // Capture text before rebuild
    for (ChoiceRow row : choices) {
      if (row.nameEd != null) row.name = text(row.nameEd);
      if (row.priceEd != null) row.priceDelta = parse(row.priceEd);
      if (row.deliveryEd != null) {
        String t = text(row.deliveryEd);
        row.deliveryPriceDelta = t.isEmpty() ? Double.NaN : parse(row.deliveryEd);
      }
    }
    choicesBox.removeAllViews();
    for (int i = 0; i < choices.size(); i++) {
      ChoiceRow row = choices.get(i);
      LinearLayout box = new LinearLayout(this);
      box.setOrientation(LinearLayout.VERTICAL);
      box.setPadding(0, NposUi.dp(this, 6), 0, NposUi.dp(this, 6));

      row.nameEd = NposUi.field(this);
      row.nameEd.setHint(R.string.menu_group_choice_name);
      row.nameEd.setText(row.name);
      row.nameEd.setLayoutParams(NposUi.matchWidth(this, 4));
      box.addView(row.nameEd);

      LinearLayout prices = new LinearLayout(this);
      prices.setOrientation(LinearLayout.HORIZONTAL);
      row.priceEd = NposUi.field(this);
      row.priceEd.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
      row.priceEd.setHint(R.string.menu_admin_col_store);
      row.priceEd.setText(String.format(Locale.US, "%.0f", row.priceDelta));
      row.priceEd.setLayoutParams(
          new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
      row.deliveryEd = NposUi.field(this);
      row.deliveryEd.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
      row.deliveryEd.setHint(R.string.menu_admin_col_delivery);
      if (!Double.isNaN(row.deliveryPriceDelta)) {
        row.deliveryEd.setText(String.format(Locale.US, "%.0f", row.deliveryPriceDelta));
      }
      LinearLayout.LayoutParams dlp =
          new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
      dlp.setMarginStart(NposUi.dp(this, 6));
      row.deliveryEd.setLayoutParams(dlp);
      prices.addView(row.priceEd);
      prices.addView(row.deliveryEd);
      box.addView(prices);

      final int idx = i;
      TextView toggle =
          NposUi.chip(
              this,
              getString(row.active ? R.string.menu_admin_status_on : R.string.menu_admin_status_off));
      NposUi.applyBtn(toggle, row.active ? NposUi.Btn.CHIP_PRIMARY : NposUi.Btn.CHIP);
      toggle.setOnClickListener(
          v -> {
            row.active = !row.active;
            paintChoices();
          });
      TextView remove = NposUi.ghost(this, getString(R.string.menu_group_remove_choice));
      remove.setOnClickListener(
          v -> {
            if (choices.size() <= 1) {
              Toast.makeText(this, R.string.menu_group_need_one, Toast.LENGTH_SHORT).show();
              return;
            }
            choices.remove(idx);
            paintChoices();
          });
      LinearLayout actions = new LinearLayout(this);
      actions.setOrientation(LinearLayout.HORIZONTAL);
      actions.setGravity(Gravity.CENTER_VERTICAL);
      toggle.setLayoutParams(NposUi.wrap(this, 8, 0));
      actions.addView(toggle);
      actions.addView(remove);
      box.addView(actions);
      choicesBox.addView(box);
    }
  }

  private void save() {
    if (busy) return;
    String name = text(nameField);
    if (name.isEmpty()) {
      Toast.makeText(this, R.string.menu_item_name_required, Toast.LENGTH_SHORT).show();
      return;
    }
    paintChoices(); // sync fields
    JSONArray options = new JSONArray();
    try {
      int n = 0;
      for (ChoiceRow row : choices) {
        String cn = row.name == null ? "" : row.name.trim();
        if (cn.isEmpty()) continue;
        JSONObject o = new JSONObject();
        o.put("id", row.id == null || row.id.isEmpty() ? "c_" + System.currentTimeMillis() + "_" + n : row.id);
        o.put("name", cn);
        o.put("priceDelta", row.priceDelta);
        if (!Double.isNaN(row.deliveryPriceDelta)) o.put("deliveryPriceDelta", row.deliveryPriceDelta);
        o.put("sortOrder", n * 1000);
        o.put("active", row.active);
        options.put(o);
        n++;
      }
      if (options.length() == 0) {
        Toast.makeText(this, R.string.menu_group_need_one, Toast.LENGTH_SHORT).show();
        return;
      }
      busy = true;
      statusLine.setText(R.string.menu_admin_saving);
      JSONObject body = new JSONObject();
      if (groupId.isEmpty()) {
        body.put("action", "addGroup");
        body.put("name", name);
      } else {
        body.put("action", "updateGroup");
        body.put("id", groupId);
        body.put("name", name);
        body.put("required", required);
        body.put("selectionType", selectionType);
        body.put("options", options);
        if ("multi".equals(selectionType)) {
          body.put("minSelect", required ? 1 : 0);
          body.put("maxSelect", options.length());
        }
      }
      menuRepo.mutate(
          this,
          body,
          (ok, res, err) ->
              runOnUiThread(
                  () -> {
                    if (!ok) {
                      busy = false;
                      statusLine.setText(R.string.menu_admin_save_fail);
                      Toast.makeText(this, R.string.menu_admin_save_fail, Toast.LENGTH_LONG).show();
                      return;
                    }
                    if (groupId.isEmpty() && res != null) {
                      groupId = res.optString("id", "");
                      // Second pass to set rules/options
                      try {
                        JSONObject upd = new JSONObject();
                        upd.put("action", "updateGroup");
                        upd.put("id", groupId);
                        upd.put("name", name);
                        upd.put("required", required);
                        upd.put("selectionType", selectionType);
                        upd.put("options", options);
                        menuRepo.mutate(
                            this,
                            upd,
                            (ok2, res2, err2) ->
                                runOnUiThread(
                                    () -> {
                                      busy = false;
                                      setResult(RESULT_OK);
                                      finish();
                                    }));
                        return;
                      } catch (Exception ignored) {
                        /* fall through */
                      }
                    }
                    busy = false;
                    setResult(RESULT_OK);
                    finish();
                  }));
    } catch (Exception e) {
      busy = false;
      Toast.makeText(this, R.string.menu_admin_save_fail, Toast.LENGTH_LONG).show();
    }
  }

  private void confirmArchive() {
    NposConfirmDialog.confirmDestructive(
        this,
        getString(R.string.menu_group_archive),
        getString(R.string.menu_group_archive_msg),
        getString(R.string.menu_group_archive),
        () -> {
          try {
            JSONObject body = new JSONObject();
            body.put("action", "archiveGroup");
            body.put("id", groupId);
            menuRepo.mutate(
                this,
                body,
                (ok, res, err) ->
                    runOnUiThread(
                        () -> {
                          if (!ok) {
                            Toast.makeText(this, R.string.menu_admin_save_fail, Toast.LENGTH_LONG)
                                .show();
                            return;
                          }
                          setResult(RESULT_OK);
                          finish();
                        }));
          } catch (Exception ignored) {
            /* ignore */
          }
        });
  }

  private MenuModels.OptionGroup findGroup(String id) {
    if (menu == null || menu.optionGroups == null) return null;
    for (MenuModels.OptionGroup g : menu.optionGroups) {
      if (id.equals(g.id)) return g;
    }
    return null;
  }

  private static String text(EditText ed) {
    return ed == null || ed.getText() == null ? "" : ed.getText().toString().trim();
  }

  private static double parse(EditText ed) {
    try {
      return Math.max(0, Double.parseDouble(text(ed).replaceAll("[^\\d.]", "")));
    } catch (Exception e) {
      return 0;
    }
  }
}
