package app.telltea.npos;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import app.telltea.npos.sell.ImageLoader;
import app.telltea.npos.sell.MenuImageUtil;
import app.telltea.npos.sell.MenuModels;
import app.telltea.npos.sell.MenuRepository;
import app.telltea.npos.shift.ShiftPrefs;
import app.telltea.npos.ui.NposConfirmDialog;
import app.telltea.npos.ui.NposFonts;
import app.telltea.npos.ui.NposUi;
import app.telltea.npos.ui.UiScale;

/** Create / edit a menu item — BOH PosMenuItemEditor parity (table-first native). */
public class MenuItemEditActivity extends Activity {
  public static final String EXTRA_ITEM_ID = "itemId";
  public static final String EXTRA_CATEGORY_ID = "categoryId";
  private static final int REQ_PICK_IMAGE = 7101;

  private final MenuRepository menuRepo = new MenuRepository();
  private UiScale ui;
  private MenuModels.Bundle menu;
  private String itemId = "";
  private String categoryId = "";
  private String imageUrl = "";
  private boolean busy;
  private boolean recommended;
  private boolean visibleOnPos = true;
  private boolean active = true;
  private final Set<String> linkedGroupIds = new HashSet<>();

  private EditText nameField;
  private EditText nameEnField;
  private EditText codeField;
  private EditText descField;
  private EditText priceField;
  private EditText deliveryField;
  private TextView categoryBtn;
  private TextView statusLine;
  private ImageView photoView;
  private LinearLayout groupsBox;
  private TextView saveBtn;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (!ShiftPrefs.isOpen(this)) {
      Toast.makeText(this, R.string.menu_admin_need_shift, Toast.LENGTH_LONG).show();
      finish();
      return;
    }
    ui = UiScale.from(this);
    NposFonts.applyActivity(this);
    Intent in = getIntent();
    if (in != null) {
      itemId = in.getStringExtra(EXTRA_ITEM_ID);
      if (itemId == null) itemId = "";
      categoryId = in.getStringExtra(EXTRA_CATEGORY_ID);
      if (categoryId == null) categoryId = "";
    }

    LinearLayout page = new LinearLayout(this);
    page.setOrientation(LinearLayout.VERTICAL);
    page.setBackgroundColor(NposUi.color(this, R.color.npos_bg));
    int pad = NposUi.dp(this, 12);
    page.setPadding(pad, pad, pad, pad);

    page.addView(
        NposUi.headerBar(
            this,
            getString(itemId.isEmpty() ? R.string.menu_item_new_title : R.string.menu_item_edit_title)));

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

    form.addView(sectionLabel(R.string.menu_item_photo));
    photoView = new ImageView(this);
    photoView.setLayoutParams(
        new LinearLayout.LayoutParams(NposUi.dp(this, 120), NposUi.dp(this, 120)));
    photoView.setScaleType(ImageView.ScaleType.CENTER_CROP);
    photoView.setBackgroundColor(0x22E85D24);
    form.addView(photoView);
    TextView pickPhoto = NposUi.secondary(this, getString(R.string.menu_item_pick_photo));
    pickPhoto.setLayoutParams(NposUi.cta(this, 6));
    pickPhoto.setOnClickListener(v -> pickImage());
    form.addView(pickPhoto);
    TextView clearPhoto = NposUi.ghost(this, getString(R.string.menu_item_clear_photo));
    clearPhoto.setLayoutParams(NposUi.cta(this, 10));
    clearPhoto.setOnClickListener(
        v -> {
          imageUrl = "";
          paintPhoto();
        });
    form.addView(clearPhoto);

    form.addView(sectionLabel(R.string.menu_admin_col_name));
    nameField = field(InputType.TYPE_CLASS_TEXT);
    form.addView(nameField);

    form.addView(sectionLabel(R.string.menu_item_name_en));
    nameEnField = field(InputType.TYPE_CLASS_TEXT);
    form.addView(nameEnField);

    form.addView(sectionLabel(R.string.menu_item_code));
    codeField = field(InputType.TYPE_CLASS_TEXT);
    form.addView(codeField);

    form.addView(sectionLabel(R.string.menu_item_category));
    categoryBtn = NposUi.secondary(this, getString(R.string.menu_item_pick_category));
    categoryBtn.setMaxWidth(Integer.MAX_VALUE);
    categoryBtn.setLayoutParams(NposUi.matchWidth(this, 8));
    categoryBtn.setOnClickListener(v -> showCategoryPicker());
    form.addView(categoryBtn);

    form.addView(sectionLabel(R.string.menu_admin_col_store));
    priceField = field(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
    form.addView(priceField);

    form.addView(sectionLabel(R.string.menu_admin_col_delivery));
    deliveryField = field(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
    deliveryField.setHint(R.string.menu_item_delivery_hint);
    form.addView(deliveryField);

    form.addView(sectionLabel(R.string.menu_item_description));
    descField = field(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
    descField.setMinLines(2);
    form.addView(descField);

    form.addView(sectionLabel(R.string.menu_item_flags));
    form.addView(flagRow());

    form.addView(sectionLabel(R.string.menu_item_option_groups));
    groupsBox = new LinearLayout(this);
    groupsBox.setOrientation(LinearLayout.VERTICAL);
    form.addView(groupsBox);

    saveBtn = NposUi.primary(this, getString(R.string.menu_item_save));
    saveBtn.setLayoutParams(NposUi.matchWidth(this, 8));
    saveBtn.setMaxWidth(Integer.MAX_VALUE);
    saveBtn.setOnClickListener(v -> save());
    form.addView(saveBtn);

    if (!itemId.isEmpty()) {
      TextView archive = NposUi.secondary(this, getString(R.string.menu_item_archive));
      archive.setLayoutParams(NposUi.matchWidth(this, 8));
      archive.setMaxWidth(Integer.MAX_VALUE);
      archive.setOnClickListener(v -> confirmArchive());
      form.addView(archive);

      TextView dup = NposUi.ghost(this, getString(R.string.menu_item_duplicate));
      dup.setLayoutParams(NposUi.matchWidth(this, 8));
      dup.setMaxWidth(Integer.MAX_VALUE);
      dup.setOnClickListener(v -> duplicate());
      form.addView(dup);
    }

    setContentView(page);
    reload();
  }

  @Override
  protected void onDestroy() {
    menuRepo.shutdown();
    super.onDestroy();
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode != REQ_PICK_IMAGE || resultCode != RESULT_OK || data == null) return;
    Uri uri = data.getData();
    if (uri == null) return;
    statusLine.setText(R.string.menu_item_photo_busy);
    new Thread(
            () -> {
              try {
                String dataUrl = MenuImageUtil.encodeSquareDataUrl(this, uri);
                runOnUiThread(
                    () -> {
                      imageUrl = dataUrl;
                      paintPhoto();
                      statusLine.setText(R.string.menu_item_photo_ready);
                    });
              } catch (Exception e) {
                runOnUiThread(
                    () -> {
                      statusLine.setText(R.string.menu_item_photo_fail);
                      Toast.makeText(
                              this,
                              e.getMessage() == null
                                  ? getString(R.string.menu_item_photo_fail)
                                  : e.getMessage(),
                              Toast.LENGTH_LONG)
                          .show();
                    });
              }
            })
        .start();
  }

  private TextView sectionLabel(int res) {
    TextView tv = NposUi.caption(this, getString(res));
    tv.setPadding(0, NposUi.dp(this, 8), 0, NposUi.dp(this, 4));
    tv.setTypeface(NposFonts.semibold(this));
    return tv;
  }

  private EditText field(int inputType) {
    EditText ed = NposUi.field(this);
    ed.setInputType(inputType);
    ed.setLayoutParams(NposUi.matchWidth(this, 6));
    return ed;
  }

  private LinearLayout flagRow() {
    LinearLayout row = new LinearLayout(this);
    row.setOrientation(LinearLayout.HORIZONTAL);
    TextView rec = NposUi.chip(this, getString(R.string.menu_item_recommended));
    TextView vis = NposUi.chip(this, getString(R.string.menu_item_visible_pos));
    TextView act = NposUi.chip(this, getString(R.string.menu_admin_status_on));
    styleFlag(rec, recommended);
    styleFlag(vis, visibleOnPos);
    styleFlag(act, active);
    rec.setOnClickListener(
        v -> {
          recommended = !recommended;
          styleFlag(rec, recommended);
        });
    vis.setOnClickListener(
        v -> {
          visibleOnPos = !visibleOnPos;
          styleFlag(vis, visibleOnPos);
        });
    act.setOnClickListener(
        v -> {
          active = !active;
          styleFlag(act, active);
          act.setText(
              getString(active ? R.string.menu_admin_status_on : R.string.menu_admin_status_off));
        });
    LinearLayout.LayoutParams lp = NposUi.wrap(this, 8, 8);
    rec.setLayoutParams(lp);
    vis.setLayoutParams(NposUi.wrap(this, 8, 8));
    act.setLayoutParams(NposUi.wrap(this, 0, 8));
    row.addView(rec);
    row.addView(vis);
    row.addView(act);
    return row;
  }

  private void styleFlag(TextView tv, boolean on) {
    NposUi.applyBtn(tv, on ? NposUi.Btn.CHIP_PRIMARY : NposUi.Btn.CHIP);
  }

  private void reload() {
    statusLine.setText(R.string.sell_loading_menu);
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
                  bindItem();
                  paintCategory();
                  paintGroups();
                  paintPhoto();
                }));
  }

  private void bindItem() {
    if (itemId.isEmpty() || menu == null) {
      if (categoryId.isEmpty() && menu != null && menu.categories != null && !menu.categories.isEmpty()) {
        for (MenuModels.Category c : menu.categories) {
          if (c.active) {
            categoryId = c.id;
            break;
          }
        }
      }
      return;
    }
    MenuModels.Item item = findItem(itemId);
    if (item == null) {
      statusLine.setText(R.string.menu_item_missing);
      return;
    }
    categoryId = item.categoryId;
    nameField.setText(item.name);
    nameEnField.setText(item.nameEn);
    codeField.setText(item.code);
    descField.setText(item.description);
    priceField.setText(String.format(Locale.US, "%.0f", item.price));
    if (!Double.isNaN(item.deliveryPrice)) {
      deliveryField.setText(String.format(Locale.US, "%.0f", item.deliveryPrice));
    }
    recommended = item.recommended;
    visibleOnPos = item.visibleOnPos;
    active = item.active;
    imageUrl = item.imageUrl == null ? "" : item.imageUrl;
    linkedGroupIds.clear();
    if (item.optionGroupIds != null) linkedGroupIds.addAll(item.optionGroupIds);
  }

  private void paintCategory() {
    String label = getString(R.string.menu_item_pick_category);
    if (menu != null && menu.categories != null) {
      for (MenuModels.Category c : menu.categories) {
        if (c.id.equals(categoryId)) {
          label = c.name + (c.active ? "" : " · " + getString(R.string.menu_admin_archived));
          break;
        }
      }
    }
    categoryBtn.setText(label);
  }

  private void paintGroups() {
    groupsBox.removeAllViews();
    if (menu == null || menu.optionGroups == null || menu.optionGroups.isEmpty()) {
      groupsBox.addView(NposUi.caption(this, getString(R.string.menu_admin_empty_groups)));
      return;
    }
    for (MenuModels.OptionGroup g : menu.optionGroups) {
      if (!g.active) continue;
      boolean on = linkedGroupIds.contains(g.id);
      TextView chip = NposUi.chip(this, g.name + (g.required ? " *" : ""));
      styleFlag(chip, on);
      chip.setLayoutParams(NposUi.matchWidth(this, 6));
      chip.setMaxWidth(Integer.MAX_VALUE);
      chip.setOnClickListener(
          v -> {
            if (linkedGroupIds.contains(g.id)) linkedGroupIds.remove(g.id);
            else linkedGroupIds.add(g.id);
            paintGroups();
          });
      groupsBox.addView(chip);
    }
  }

  private void paintPhoto() {
    if (imageUrl == null || imageUrl.isEmpty()) {
      photoView.setImageDrawable(null);
      photoView.setBackgroundColor(0x22E85D24);
      return;
    }
    ImageLoader.bind(photoView, imageUrl, 0x22E85D24);
  }

  private void pickImage() {
    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
    intent.setType("image/*");
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    startActivityForResult(Intent.createChooser(intent, getString(R.string.menu_item_pick_photo)), REQ_PICK_IMAGE);
  }

  private void showCategoryPicker() {
    if (menu == null || menu.categories == null) return;
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    int pad = ui.dp(12);
    box.setPadding(pad, pad, pad, pad);
    final AlertDialog[] holder = new AlertDialog[1];
    for (MenuModels.Category c : menu.categories) {
      if (!c.active) continue;
      TextView b = NposUi.secondary(this, c.name);
      b.setMaxWidth(Integer.MAX_VALUE);
      b.setLayoutParams(NposUi.matchWidth(this, 8));
      b.setOnClickListener(
          v -> {
            categoryId = c.id;
            paintCategory();
            if (holder[0] != null) holder[0].dismiss();
          });
      box.addView(b);
    }
    TextView cancel = NposUi.ghost(this, getString(android.R.string.cancel));
    cancel.setMaxWidth(Integer.MAX_VALUE);
    cancel.setOnClickListener(
        v -> {
          if (holder[0] != null) holder[0].dismiss();
        });
    box.addView(cancel);
    holder[0] =
        new AlertDialog.Builder(this)
            .setTitle(R.string.menu_item_category)
            .setView(box)
            .create();
    holder[0].show();
  }

  private void save() {
    if (busy || menu != null && menu.demo) return;
    String name = nameField.getText() == null ? "" : nameField.getText().toString().trim();
    if (name.isEmpty()) {
      Toast.makeText(this, R.string.menu_item_name_required, Toast.LENGTH_SHORT).show();
      return;
    }
    if (categoryId == null || categoryId.isEmpty()) {
      Toast.makeText(this, R.string.menu_item_category_required, Toast.LENGTH_SHORT).show();
      return;
    }
    busy = true;
    statusLine.setText(R.string.menu_admin_saving);
    saveBtn.setEnabled(false);
    try {
      JSONObject body = new JSONObject();
      if (itemId.isEmpty()) {
        body.put("action", "addItem");
        body.put("categoryId", categoryId);
        body.put("name", name);
        body.put("price", parsePrice(priceField));
        Double del = parseOptionalPrice(deliveryField);
        if (del != null) body.put("deliveryPrice", del);
      } else {
        body.put("action", "updateItem");
        body.put("id", itemId);
        body.put("categoryId", categoryId);
        body.put("name", name);
        body.put("nameEn", textOf(nameEnField));
        body.put("code", textOf(codeField));
        body.put("description", textOf(descField));
        body.put("price", parsePrice(priceField));
        Double del = parseOptionalPrice(deliveryField);
        if (del == null) body.put("deliveryPrice", JSONObject.NULL);
        else body.put("deliveryPrice", del);
        body.put("active", active);
        body.put("visibleOnPos", visibleOnPos);
        body.put("recommended", recommended);
        body.put("imageUrl", imageUrl == null ? "" : imageUrl);
        JSONArray gids = new JSONArray();
        for (String g : linkedGroupIds) gids.put(g);
        body.put("optionGroupIds", gids);
      }
      menuRepo.mutate(
          this,
          body,
          (ok, res, err) ->
              runOnUiThread(
                  () -> {
                    busy = false;
                    saveBtn.setEnabled(true);
                    if (!ok) {
                      statusLine.setText(R.string.menu_admin_save_fail);
                      Toast.makeText(this, R.string.menu_admin_save_fail, Toast.LENGTH_LONG).show();
                      return;
                    }
                    // New item: follow-up update for extra fields / photo / groups.
                    if (itemId.isEmpty() && res != null) {
                      String newId = res.optString("id", "");
                      if (!newId.isEmpty()) {
                        itemId = newId;
                        patchNewItemExtras();
                        return;
                      }
                    }
                    statusLine.setText(R.string.menu_admin_saved);
                    Toast.makeText(this, R.string.menu_admin_saved, Toast.LENGTH_SHORT).show();
                    setResult(RESULT_OK);
                    finish();
                  }));
    } catch (Exception e) {
      busy = false;
      saveBtn.setEnabled(true);
      Toast.makeText(this, R.string.menu_admin_save_fail, Toast.LENGTH_LONG).show();
    }
  }

  private void patchNewItemExtras() {
    try {
      JSONObject body = new JSONObject();
      body.put("action", "updateItem");
      body.put("id", itemId);
      body.put("nameEn", textOf(nameEnField));
      body.put("code", textOf(codeField));
      body.put("description", textOf(descField));
      body.put("active", active);
      body.put("visibleOnPos", visibleOnPos);
      body.put("recommended", recommended);
      body.put("imageUrl", imageUrl == null ? "" : imageUrl);
      JSONArray gids = new JSONArray();
      for (String g : linkedGroupIds) gids.put(g);
      body.put("optionGroupIds", gids);
      Double del = parseOptionalPrice(deliveryField);
      if (del == null) body.put("deliveryPrice", JSONObject.NULL);
      else body.put("deliveryPrice", del);
      menuRepo.mutate(
          this,
          body,
          (ok, res, err) ->
              runOnUiThread(
                  () -> {
                    busy = false;
                    saveBtn.setEnabled(true);
                    statusLine.setText(R.string.menu_admin_saved);
                    Toast.makeText(this, R.string.menu_admin_saved, Toast.LENGTH_SHORT).show();
                    setResult(RESULT_OK);
                    finish();
                  }));
    } catch (Exception e) {
      busy = false;
      saveBtn.setEnabled(true);
      setResult(RESULT_OK);
      finish();
    }
  }

  private void confirmArchive() {
    NposConfirmDialog.confirmDestructive(
        this,
        getString(R.string.menu_item_archive),
        getString(R.string.menu_item_archive_msg),
        getString(R.string.menu_item_archive),
        () -> {
          try {
            JSONObject body = new JSONObject();
            body.put("action", "archiveItem");
            body.put("id", itemId);
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

  private void duplicate() {
    try {
      JSONObject body = new JSONObject();
      body.put("action", "duplicateItem");
      body.put("id", itemId);
      menuRepo.mutate(
          this,
          body,
          (ok, res, err) ->
              runOnUiThread(
                  () -> {
                    if (!ok || res == null) {
                      Toast.makeText(this, R.string.menu_admin_save_fail, Toast.LENGTH_LONG).show();
                      return;
                    }
                    String newId = res.optString("id", "");
                    if (newId.isEmpty()) return;
                    Intent next = new Intent(this, MenuItemEditActivity.class);
                    next.putExtra(EXTRA_ITEM_ID, newId);
                    startActivity(next);
                    setResult(RESULT_OK);
                    finish();
                  }));
    } catch (Exception ignored) {
      /* ignore */
    }
  }

  private MenuModels.Item findItem(String id) {
    if (menu == null || menu.items == null) return null;
    for (MenuModels.Item it : menu.items) {
      if (id.equals(it.id)) return it;
    }
    return null;
  }

  private static String textOf(EditText ed) {
    return ed.getText() == null ? "" : ed.getText().toString().trim();
  }

  private static double parsePrice(EditText ed) {
    try {
      return Math.max(0, Double.parseDouble(textOf(ed).replaceAll("[^\\d.]", "")));
    } catch (Exception e) {
      return 0;
    }
  }

  private static Double parseOptionalPrice(EditText ed) {
    String t = textOf(ed);
    if (t.isEmpty()) return null;
    try {
      return Math.max(0, Double.parseDouble(t.replaceAll("[^\\d.]", "")));
    } catch (Exception e) {
      return null;
    }
  }
}
