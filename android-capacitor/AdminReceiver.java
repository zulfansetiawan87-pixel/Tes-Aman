package id.sch.securequiz.kiosk;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;
import android.widget.Toast;

public class AdminReceiver extends DeviceAdminReceiver {
  @Override
  public void onEnabled(Context context, Intent intent) {
    super.onEnabled(context, intent);
    Toast.makeText(context, "SECURE QUIZ Device Admin Aktif", Toast.LENGTH_SHORT).show();
  }

  @Override
  public void onLockTaskModeEntering(Context context, Intent intent, String pkg) {
    super.onLockTaskModeEntering(context, intent, pkg);
  }

  @Override
  public void onLockTaskModeExiting(Context context, Intent intent) {
    super.onLockTaskModeExiting(context, intent);
  }
}
