package id.sch.securequiz.kiosk;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "KioskLock")
public class KioskLockPlugin extends Plugin {

  @PluginMethod
  public void enableExamLock(PluginCall call) {
    Activity activity = getActivity();
    if (activity == null) {
      call.reject("Activity unavailable");
      return;
    }

    activity.runOnUiThread(() -> {
      // Prevent OS-level screenshots & screen recording
      activity.getWindow().setFlags(
        WindowManager.LayoutParams.FLAG_SECURE,
        WindowManager.LayoutParams.FLAG_SECURE
      );

      DevicePolicyManager dpm = (DevicePolicyManager)
        activity.getSystemService(Context.DEVICE_POLICY_SERVICE);
      ComponentName adminComponent = new ComponentName(activity, AdminReceiver.class);

      boolean isDeviceOwner = dpm != null && dpm.isDeviceOwnerApp(activity.getPackageName());
      if (isDeviceOwner) {
        dpm.setLockTaskPackages(adminComponent, new String[]{ activity.getPackageName() });
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          dpm.setLockTaskFeatures(adminComponent, DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
        }
      }

      activity.startLockTask();

      JSObject ret = new JSObject();
      ret.put("locked", true);
      ret.put("deviceOwner", isDeviceOwner);
      ret.put("flagSecure", true);
      call.resolve(ret);
    });
  }

  @PluginMethod
  public void disableExamLock(PluginCall call) {
    Activity activity = getActivity();
    if (activity == null) {
      call.reject("Activity unavailable");
      return;
    }

    activity.runOnUiThread(() -> {
      try {
        activity.stopLockTask();
      } catch (IllegalStateException ignored) {
        // Not currently in lock task mode
      }
      activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);

      JSObject ret = new JSObject();
      ret.put("locked", false);
      call.resolve(ret);
    });
  }
}
