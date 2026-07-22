package app.telltea.npos.update;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.util.Log;
import android.widget.Toast;

/** Receives PackageInstaller session status for nPos-telltea updates. */
public final class InstallResultReceiver extends BroadcastReceiver {
    public static final String ACTION = "app.telltea.npos.UPDATE_INSTALL_RESULT";
    private static final String TAG = "nPosUpdate";
    private static final String INSTALL_PAGE = "https://telltea-pos.web.app/install/";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        switch (status) {
            case PackageInstaller.STATUS_PENDING_USER_ACTION: {
                Intent confirm;
                if (android.os.Build.VERSION.SDK_INT >= 33) {
                    confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
                } else {
                    confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                }
                if (confirm != null) {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(confirm);
                }
                break;
            }
            case PackageInstaller.STATUS_SUCCESS:
                Toast.makeText(context, "อัปเดตสำเร็จ — กลับหน้าร้าน", Toast.LENGTH_LONG).show();
                try {
                    ResumePrefs.markResumeSellAfterUpdate(context);
                    Intent relaunch = new Intent(context, app.telltea.npos.MainActivity.class);
                    relaunch.addFlags(
                            Intent.FLAG_ACTIVITY_NEW_TASK
                                    | Intent.FLAG_ACTIVITY_CLEAR_TASK
                                    | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    relaunch.putExtra("resume_sell", true);
                    context.startActivity(relaunch);
                } catch (Exception e) {
                    Log.w(TAG, "relaunch after update failed", e);
                }
                break;
            default:
                Log.w(TAG, "install failed status=" + status + " msg=" + message);
                String tip =
                        "ติดตั้งทับไม่ได้ — ถอนแอปนี้ครั้งหนึ่ง แล้วเปิดหน้าติดตั้ง";
                Toast.makeText(context, tip, Toast.LENGTH_LONG).show();
                try {
                    Intent web = new Intent(Intent.ACTION_VIEW, Uri.parse(INSTALL_PAGE));
                    web.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(web);
                } catch (Exception ignored) {
                    /* no browser */
                }
                break;
        }
    }
}
