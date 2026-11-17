import React, { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Shield,
  ShieldAlert,
  Smartphone,
  Terminal,
  XCircle,
} from 'lucide-react';

const CAPACITOR_CONFIG_SNIPPET = `import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'id.sch.securequiz.kiosk',
  appName: 'SECURE QUIZ',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // Untuk produksi, arahkan ke URL HTTPS server Anda atau gunakan bundle lokal
    // url: 'https://quiz-anda.run.app',
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;`;

const KIOSK_PLUGIN_JAVA = `package id.sch.securequiz.kiosk;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
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
      // 1. Blokir screenshot & screen recording di tingkat OS Android
      activity.getWindow().setFlags(
        WindowManager.LayoutParams.FLAG_SECURE,
        WindowManager.LayoutParams.FLAG_SECURE
      );

      // 2. Cek apakah aplikasi berstatus Device Owner untuk Lock Task Mode penuh
      DevicePolicyManager dpm = (DevicePolicyManager)
        activity.getSystemService(Context.DEVICE_POLICY_SERVICE);
      ComponentName adminComponent = new ComponentName(activity, AdminReceiver.class);

      boolean isDeviceOwner = dpm != null && dpm.isDeviceOwnerApp(activity.getPackageName());
      if (isDeviceOwner) {
        dpm.setLockTaskPackages(adminComponent, new String[]{ activity.getPackageName() });
        dpm.setLockTaskFeatures(adminComponent, DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
      }

      // 3. Aktifkan Android Lock Task Mode (Screen Pinning / Kiosk)
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
      activity.stopLockTask();
      activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
      JSObject ret = new JSObject();
      ret.put("locked", false);
      call.resolve(ret);
    });
  }
}`;

export const NativeArchitectureView: React.FC = () => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copySnippet = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 space-y-8">
      <div className="rounded-2xl border border-slate-200 bg-[#0F2544] p-6 sm:p-8 text-white">
        <div className="flex items-center gap-2 text-orange-400">
          <Shield className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-wider">
            Arsitektur Keamanan Berlapis & Transparansi Teknis
          </span>
        </div>
        <h1 className="mt-2 font-display text-2xl font-bold sm:text-3xl text-balance">
          Batasan Web Browser vs Penguncian Native Android (Lock Task Mode)
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
          SECURE QUIZ dirancang jujur secara rekayasa keamanan: lapisan PWA web menyediakan deteksi pelanggaran dan proteksi integritas server, sementara penguncian sistem operasi penuh dicapai melalui pembungkus native Capacitor dengan Device Owner.
        </p>
      </div>

      {/* Honest Capabilities Comparison */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="font-display text-lg font-bold text-slate-900">
            Kemampuan Keamanan Web / PWA (Browser)
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Aktif langsung di Chrome, Edge, dan Safari tanpa instalasi APK.
          </p>

          <ul className="mt-5 space-y-3 text-sm">
            <li className="flex items-start gap-2.5 text-slate-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                <strong>Fullscreen API & Deteksi Keluar:</strong> Memicu layar penuh dan mencatat waktu kejadian saat peserta keluar dari fullscreen.
              </span>
            </li>
            <li className="flex items-start gap-2.5 text-slate-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                <strong>Deteksi Visibility & Focus:</strong> Mencatat perpindahan tab (`visibilitychange`) dan perpindahan fokus jendela (`blur`).
              </span>
            </li>
            <li className="flex items-start gap-2.5 text-slate-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                <strong>Pembatasan Clipboard & Seleksi:</strong> Memblokir copy, cut, paste, klik kanan, serta pintasan Ctrl+U/P/S/F12.
              </span>
            </li>
            <li className="flex items-start gap-2.5 text-slate-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                <strong>Otoritas Waktu & Kunci Terenkripsi Server:</strong> Kunci jawaban dienkripsi AES-256-GCM; skor dan batas waktu diverifikasi server dengan HMAC-SHA256.
              </span>
            </li>
            <li className="flex items-start gap-2.5 text-slate-700 pt-2 border-t border-slate-100">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
              <span>
                <strong>Keterbatasan Inheren Web:</strong> Browser standar <strong>tidak dapat</strong> memblokir tombol Power/Home/Recent Apps, mencegah screenshot level OS, atau menutup paksa fitur split-screen OS (hanya dapat mendeteksi penyusutan ukuran viewport).
              </span>
            </li>
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-blue-600" />
            <h2 className="font-display text-lg font-bold text-slate-900">
              Android Native Wrapper (Capacitor + Device Owner)
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Menutup celah OS untuk perangkat tablet/HP sekolah terkelola (MDM / ADB).
          </p>

          <ul className="mt-5 space-y-3 text-sm">
            <li className="flex items-start gap-2.5 text-slate-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <span>
                <strong>Lock Task Mode (Kiosk Penuh):</strong> Dengan status Device Owner, `startLockTask()` mengunci tombol Home, Back, Recent Apps, dan panel notifikasi.
              </span>
            </li>
            <li className="flex items-start gap-2.5 text-slate-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <span>
                <strong>WindowManager.FLAG_SECURE:</strong> Mencegah tangkapan layar (screenshot) maupun perekaman layar sistem Android selama ujian berlangsung.
              </span>
            </li>
            <li className="flex items-start gap-2.5 text-slate-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <span>
                <strong>Blokir Split-Screen Paksa:</strong> Atribut manifest `android:resizeableActivity=&quot;false&quot;` melarang mode multi-jendela di Android.
              </span>
            </li>
          </ul>

          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
              <Terminal className="h-4 w-4 text-orange-600" />
              <span>Perintah Aktivasi Device Owner via ADB (Perangkat Lab Sekolah)</span>
            </div>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-[#0A192F] p-3 font-mono text-[11px] text-slate-100">
              adb shell dpm set-device-owner id.sch.securequiz.kiosk/.AdminReceiver
            </pre>
          </div>
        </div>
      </div>

      {/* Code Artifacts Preview */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <span className="font-mono text-xs font-semibold text-slate-900">
              android-capacitor/capacitor.config.ts
            </span>
            <button
              type="button"
              onClick={() => void copySnippet('cap', CAPACITOR_CONFIG_SNIPPET)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              {copiedId === 'cap' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copiedId === 'cap' ? 'Disalin' : 'Salin'}</span>
            </button>
          </div>
          <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-slate-200">
            {CAPACITOR_CONFIG_SNIPPET}
          </pre>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <span className="font-mono text-xs font-semibold text-slate-900">
              android-capacitor/KioskLockPlugin.java
            </span>
            <button
              type="button"
              onClick={() => void copySnippet('java', KIOSK_PLUGIN_JAVA)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              {copiedId === 'java' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copiedId === 'java' ? 'Disalin' : 'Salin'}</span>
            </button>
          </div>
          <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-slate-200">
            {KIOSK_PLUGIN_JAVA}
          </pre>
        </div>
      </div>

      <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5 text-sm text-slate-800 flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
        <div>
          <p className="font-semibold text-slate-900">
            File Sumber Capacitor & Panduan Lengkap Tersedia di Repositori
          </p>
          <p className="mt-1 text-xs text-slate-700">
            Seluruh berkas sumber Android Capacitor (<span className="font-mono">android-capacitor/</span>) dan dokumentasi konfigurasi/deployment lengkap (<span className="font-mono">docs/DEPLOYMENT_AND_CONFIG.md</span>) telah disertakan langsung di dalam proyek ini.
          </p>
        </div>
      </div>
    </div>
  );
};
