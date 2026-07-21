package app.telltea.npos.update;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.util.Log;
import android.widget.Toast;

/** Receives PackageInstaller session status for nPos-telltea updates. */
public final class InstallResultReceiver extends BroadcastReceiver {
    public static final String ACTION = "app.telltea.npos.UPDATE_INSTALL_RESULT";
    private static final String TAG = "nPosUpdate";

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
                Toast.makeText(context, "อัปเดตสำเร็จ", Toast.LENGTH_LONG).show();
                break;
            default:
                Log.w(TAG, "install failed status=" + status + " msg=" + message);
                Toast.makeText(
                                context,
                                "อัปเดตล้มเหลว" + (message == null || message.isEmpty() ? "" : ": " + message),
                                Toast.LENGTH_LONG)
                        .show();
                break;
        }
    }
}
