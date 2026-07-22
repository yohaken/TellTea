package app.telltea.npos;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;

import java.lang.ref.WeakReference;

/** Tracks the foreground activity for PixelCopy screen capture. */
public final class NposApp extends Application {
    private static WeakReference<Activity> currentActivity = new WeakReference<>(null);

    @Override
    public void onCreate() {
        super.onCreate();
        registerActivityLifecycleCallbacks(
                new ActivityLifecycleCallbacks() {
                    @Override
                    public void onActivityResumed(Activity activity) {
                        currentActivity = new WeakReference<>(activity);
                    }

                    @Override
                    public void onActivityPaused(Activity activity) {
                        // Keep last activity for PixelCopy while briefly paused
                        // (heartbeat capture can race with UI pause).
                    }

                    @Override
                    public void onActivityCreated(Activity a, Bundle b) {}

                    @Override
                    public void onActivityStarted(Activity a) {}

                    @Override
                    public void onActivityStopped(Activity a) {}

                    @Override
                    public void onActivitySaveInstanceState(Activity a, Bundle b) {}

                    @Override
                    public void onActivityDestroyed(Activity a) {
                        Activity cur = currentActivity.get();
                        if (cur == a) currentActivity = new WeakReference<>(null);
                    }
                });
    }

    public static Activity foregroundActivity() {
        return currentActivity.get();
    }
}
