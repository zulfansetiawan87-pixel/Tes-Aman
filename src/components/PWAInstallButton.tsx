import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall.ts';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="h-3.5 w-3.5" />
        <span>Pasang PWA</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Smartphone className="h-3.5 w-3.5 text-blue-600" />
        <span>{isIOS ? 'Pasang iOS' : 'Mode Aplikasi'}</span>
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-lg font-semibold text-slate-900">
                  Pasang SECURE QUIZ sebagai Aplikasi
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Mendukung peluncuran layar penuh mandiri dan pemulihan sesi saat jaringan terputus.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                aria-label="Tutup panduan instalasi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm text-slate-700">
              {isIOS ? (
                <ol className="list-decimal space-y-2 pl-5">
                  <li>
                    Ketuk ikon <strong>Bagikan (Share)</strong> pada bilah Safari.
                  </li>
                  <li>
                    Gulir ke bawah dan pilih <strong>Tambahkan ke Layar Utama (Add to Home Screen)</strong>.
                  </li>
                </ol>
              ) : (
                <ol className="list-decimal space-y-2 pl-5">
                  <li>
                    Buka menu browser Chrome/Edge (ikon tiga titik di kanan atas).
                  </li>
                  <li>
                    Pilih <strong>Install App</strong> atau <strong>Tambahkan ke Layar Utama</strong>.
                  </li>
                </ol>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full rounded-lg bg-[#0F2544] py-2.5 text-sm font-semibold text-white hover:bg-slate-800 cursor-pointer"
            >
              Mengerti
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 left-4 z-50 flex items-center gap-2 rounded-lg border border-orange-300 bg-orange-600 px-3.5 py-2 text-xs font-medium text-white shadow-lg"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      <span>Koneksi terputus — Jawaban tersimpan lokal dan akan disinkronkan ulang.</span>
    </div>
  );
};
