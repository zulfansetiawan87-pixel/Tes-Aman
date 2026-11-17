import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  FileSpreadsheet,
  Lock,
  Shield,
  ShieldCheck,
  Smartphone,
  Users,
} from 'lucide-react';
import { AdminPortal } from './components/AdminPortal.tsx';
import { NativeArchitectureView } from './components/NativeArchitectureView.tsx';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton.tsx';
import { StudentPortal } from './components/StudentPortal.tsx';
import { downloadQuizImportTemplateDocx } from './lib/docxTemplateClient.ts';
import { testFirestoreConnection } from './lib/firebase.ts';

type AppRoute = 'home' | 'student' | 'admin' | 'native';

export default function App() {
  const [route, setRoute] = useState<AppRoute>('home');

  useEffect(() => {
    void testFirestoreConnection();
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Three-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-8 px-4 sm:px-6">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => setRoute('home')}
            className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 cursor-pointer"
          >
            <img
              src="/icon.svg"
              alt="Logo SECURE QUIZ"
              className="h-8 w-8 rounded-lg"
            />
            <span className="font-display text-lg font-bold tracking-tight text-[#0F2544]">
              SECURE QUIZ
            </span>
          </button>

          {/* Zone 2: Concise Single-Line Nav Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => setRoute('home')}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-[#0F2544] cursor-pointer ${
                route === 'home' ? 'font-semibold text-[#0F2544]' : ''
              }`}
            >
              Beranda
            </button>
            <button
              type="button"
              onClick={() => setRoute('student')}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-[#0F2544] cursor-pointer ${
                route === 'student' ? 'font-semibold text-blue-700' : ''
              }`}
            >
              Portal Murid
            </button>
            <button
              type="button"
              onClick={() => setRoute('admin')}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-[#0F2544] cursor-pointer ${
                route === 'admin' ? 'font-semibold text-blue-700' : ''
              }`}
            >
              Portal Admin
            </button>
            <button
              type="button"
              onClick={() => setRoute('native')}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-[#0F2544] cursor-pointer ${
                route === 'native' ? 'font-semibold text-blue-700' : ''
              }`}
            >
              Android Kiosk
            </button>
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="flex items-center gap-3 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              onClick={() => setRoute(route === 'student' ? 'admin' : 'student')}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0F2544] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>{route === 'student' ? 'Masuk Admin' : 'Mulai Ujian'}</span>
            </button>
          </div>
        </div>

        {/* Mobile Nav Strip */}
        <div className="flex md:hidden items-center justify-around border-t border-slate-100 bg-white px-2 py-1.5 text-xs font-medium text-slate-600">
          <button
            type="button"
            onClick={() => setRoute('home')}
            className={`min-h-[38px] px-3 rounded-lg cursor-pointer ${
              route === 'home' ? 'bg-slate-100 font-semibold text-[#0F2544]' : ''
            }`}
          >
            Beranda
          </button>
          <button
            type="button"
            onClick={() => setRoute('student')}
            className={`min-h-[38px] px-3 rounded-lg cursor-pointer ${
              route === 'student' ? 'bg-blue-50 font-semibold text-blue-700' : ''
            }`}
          >
            Murid
          </button>
          <button
            type="button"
            onClick={() => setRoute('admin')}
            className={`min-h-[38px] px-3 rounded-lg cursor-pointer ${
              route === 'admin' ? 'bg-blue-50 font-semibold text-blue-700' : ''
            }`}
          >
            Admin
          </button>
          <button
            type="button"
            onClick={() => setRoute('native')}
            className={`min-h-[38px] px-3 rounded-lg cursor-pointer ${
              route === 'native' ? 'bg-blue-50 font-semibold text-blue-700' : ''
            }`}
          >
            Android Kiosk
          </button>
        </div>
      </header>

      <main className="flex-1">
        {route === 'home' && (
          <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-14 space-y-12">
            {/* Hero Section */}
            <section className="grid gap-8 lg:grid-cols-12 lg:items-stretch">
              <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
                <div className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                  Evaluasi Akademik Terproteksi · PWA & Android Kiosk Ready
                </div>
                <h1 className="font-display text-3xl font-bold leading-tight text-[#0F2544] sm:text-4xl lg:text-5xl text-balance">
                  Ujian Digital Aman untuk Penilaian Bahasa Inggris Multimodal
                </h1>
                <p className="max-w-xl text-base leading-relaxed text-slate-600">
                  Dirancang untuk sekolah dan perguruan tinggi dengan 5 tipe soal interaktif, validasi waktu & kunci terenkripsi di server, impor DOCX/PDF, pemulihan sesi otomatis, serta ekspor laporan Excel, CSV, dan PDF.
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setRoute('student')}
                    className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-orange-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-orange-700 cursor-pointer"
                  >
                    <span>Masuk sebagai Murid</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoute('admin')}
                    className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-6 text-sm font-semibold text-[#0F2544] transition-colors hover:bg-slate-100 cursor-pointer"
                  >
                    <ShieldCheck className="h-4 w-4 text-blue-600" />
                    <span>Masuk Portal Admin</span>
                  </button>
                </div>
              </div>

              <div className="lg:col-span-6">
                <div className="h-full overflow-hidden rounded-2xl border border-slate-200 bg-[#0F2544]">
                  <img
                    src="/src/assets/images/hero_secure_quiz_1794813402335.jpg"
                    alt="Lingkungan studio ujian digital modern SECURE QUIZ"
                    referrerPolicy="no-referrer"
                    className="h-full min-h-[280px] w-full object-cover"
                  />
                </div>
              </div>
            </section>

            {/* Full-Width 4-Column Capability Strip */}
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <BookOpen className="h-5 w-5 text-blue-600" />
                <h2 className="mt-3 font-display text-sm font-bold text-slate-900">
                  5 Tipe Soal & Multimodal
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                  Pilihan Ganda, PG Kompleks, Mengelompokkan, Uraian Singkat, dan Uraian Panjang dengan teks bacaan, gambar, dan audio listening.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <Lock className="h-5 w-5 text-orange-600" />
                <h2 className="mt-3 font-display text-sm font-bold text-slate-900">
                  Kunci Terenkripsi Server
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                  Kunci jawaban disegel AES-256-GCM dan tidak pernah dikirim ke peramban murid. Skor serta waktu diverifikasi server.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <FileSpreadsheet className="h-5 w-5 text-blue-600" />
                <h2 className="mt-3 font-display text-sm font-bold text-slate-900">
                  Impor DOCX/PDF & Ekspor
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                  Sediakan template DOCX resmi, verifikasi manual sebelum simpan, dan ekspor hasil analisis ke Excel, CSV, atau PDF.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <Smartphone className="h-5 w-5 text-orange-600" />
                <h2 className="mt-3 font-display text-sm font-bold text-slate-900">
                  PWA + Android Kiosk Mode
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                  Proctoring web (Fullscreen, Focus, Clipboard) dilengkapi blueprint Android Capacitor Lock Task Mode & Device Owner.
                </p>
              </div>
            </section>

            {/* Quick Role Guide */}
            <section className="grid gap-6 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-blue-700 text-xs font-semibold">
                    <Users className="h-4 w-4" />
                    <span>UNTUK MURID / PESERTA</span>
                  </div>
                  <h3 className="mt-2 font-display text-lg font-bold text-slate-900">
                    Masuk Cukup dengan Nama, NIS, dan Kelas
                  </h3>
                  <p className="mt-2 text-sm text-slate-600">
                    Lihat daftar ujian sesuai kelas, baca petunjuk, kerjakan soal di tampilan mobile-first dengan tandai ragu-ragu, autosave, dan pemulihan sesi otomatis bila browser tertutup.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRoute('student')}
                  className="mt-5 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 cursor-pointer self-start"
                >
                  <span>Buka Ruang Ujian Murid</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-orange-600 text-xs font-semibold">
                    <Shield className="h-4 w-4" />
                    <span>UNTUK GURU / ADMINISTRATOR</span>
                  </div>
                  <h3 className="mt-2 font-display text-lg font-bold text-slate-900">
                    Kelola Bank Soal, Penjadwalan, dan Analisis Nilai
                  </h3>
                  <p className="mt-2 text-sm text-slate-600">
                    Login menggunakan akun Google terverifikasi untuk membuat kuis, mengimpor dokumen DOCX/PDF, memantau pelanggaran peserta, menilai uraian panjang, dan mengunduh rekap nilai.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRoute('admin')}
                  className="mt-5 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#0F2544] px-4 text-sm font-semibold text-white hover:bg-slate-800 cursor-pointer self-start"
                >
                  <span>Buka Konsol Admin</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </section>
          </div>
        )}

        {route === 'student' && <StudentPortal />}
        {route === 'admin' && <AdminPortal />}
        {route === 'native' && <NativeArchitectureView />}
      </main>

      <footer className="border-t border-slate-200 bg-white py-6 text-xs text-slate-500">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>SECURE QUIZ — Sistem Evaluasi Akademik Terproteksi</p>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setRoute('native')}
              className="hover:text-slate-900 cursor-pointer"
            >
              Arsitektur Android Lock Task Mode
            </button>
            <button
              type="button"
              onClick={() => void downloadQuizImportTemplateDocx()}
              className="hover:text-slate-900 cursor-pointer"
            >
              Template Impor DOCX
            </button>
          </div>
        </div>
      </footer>

      <OfflineIndicator />
    </div>
  );
}
