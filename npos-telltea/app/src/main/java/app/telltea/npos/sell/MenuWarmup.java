package app.telltea.npos.sell;

import android.content.Context;

/**
 * Warm local menu/shop caches as soon as the app is in the foreground so Sell
 * opens from disk first (native-feel) while network syncs in the background.
 */
public final class MenuWarmup {
    private static final MenuRepository REPO = new MenuRepository();
    private static volatile boolean warming;

    private MenuWarmup() {}

    public static void warm(Context context) {
        if (context == null || warming) return;
        warming = true;
        Context app = context.getApplicationContext();
        try {
            REPO.loadMenu(
                    app,
                    false,
                    bundle -> {
                        try {
                            if (bundle != null && !bundle.demo) {
                                java.util.ArrayList<String> urls = new java.util.ArrayList<>();
                                for (MenuModels.Item item : bundle.items) {
                                    if (item.imageUrl != null && !item.imageUrl.isEmpty()) {
                                        urls.add(item.imageUrl);
                                    }
                                }
                                ImageLoader.prefetch(app, urls);
                            }
                        } finally {
                            warming = false;
                        }
                    });
            REPO.loadShop(app, shop -> {});
        } catch (Exception e) {
            warming = false;
        }
    }
}
