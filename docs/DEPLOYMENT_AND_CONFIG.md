# Dokumentasi Deployment & Konfigurasi — SECURE QUIZ

## 1. Ringkasan Arsitektur
- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Vite + `vite-plugin-pwa` (Workbox Service Worker & Web App Manifest).
- **Backend Server**: Express (`server.ts`, port `3000`) untuk:
  - Enkripsi kunci jawaban **AES-256-GCM** (`/api/admin/seal-keys`).
  - Penerbitan sesi ujian murid bertanda tangan **HMAC-SHA256** & validasi jam server (`/api/student/session/start`).
  - Penilaian otomatis sisi server & penerbitan tanda terima **HMAC-SHA256** (`/api/student/attempt/submit`).
  - Pembuatan template `.docx` (`/api/import/template.docx`) & parser dokumen `.docx` / `.pdf` (`/api/import/parse`).
- **Database & Otentikasi**: Firebase Firestore (dengan aturan keamanan `firestore.rules` yang ketat) dan Google Sign-In untuk Admin/Guru.

---

## 2. Konfigurasi Variabel Lingkungan
Salin `.env.example` menjadi `.env` di lingkungan produksi dan isi nilai berikut:
- `QUIZ_SEAL_SECRET`: String acak minimal 32 karakter untuk enkripsi AES-256-GCM `sealedKeyPack` dan tanda tangan `serverReceipt`.
- `SESSION_SECRET`: String acak minimal 32 karakter untuk tanda tangan token sesi murid.
- `PORT`: Default `3000`.

> **Catatan**: Konfigurasi Firebase proyek aktif berada di `firebase-applet-config.json`. Jangan pernah menaruh kunci privat layanan di sisi frontend.

---

## 3. Aturan Keamanan Database (`firestore.rules`)
- `/quizKeys/{quizId}`, `/questionBank/{id}`, `/participants/{id}`: Hanya dapat diakses oleh Admin terverifikasi (`isAdmin()`).
- `/quizzes/{quizId}`: Murid hanya dapat membaca kuis berstatus `published`; seluruh kunci jawaban telah dipisahkan dan hanya `sealedKeyPack` terenkripsi yang ada di dokumen publik.
- `/attempts/{attemptId}`: `list` dibatasi hanya untuk Admin; murid hanya dapat membuat dokumen `in_progress`, melakukan autosave saat `in_progress`, dan menyelesaikan satu kali (`submitted`) disertai `serverReceipt` dari server.
- `/attempts/{attemptId}/violations/{violationId}`: Append-only selama attempt masih `in_progress`.

Untuk memperbarui aturan di proyek Firebase:
```bash
npx eslint firestore.rules
firebase deploy --only firestore:rules
```

---

## 4. Menjalankan Secara Lokal & Produksi
1. Instal dependensi:
   ```bash
   npm install
   ```
2. Mode pengembangan (Express + Vite HMR/Middleware pada port 3000):
   ```bash
   npm run dev
   ```
3. Build & jalankan mode produksi:
   ```bash
   npm run build
   NODE_ENV=production npm start
   ```

---

## 5. Verifikasi PWA (Installability)
- Pastikan aplikasi diakses melalui HTTPS (atau `localhost` saat pengujian lokal).
- Manifest PWA dan ikon (`192x192`, `512x512`, `maskable 512x512`, dan `apple-touch-icon 180x180`) tersedia di direktori `public/`.
- Gunakan tombol **Pasang PWA** di header aplikasi pada Chrome/Edge/Android, atau **Bagikan -> Tambahkan ke Layar Utama** pada iOS Safari.

---

## 6. Build Android Capacitor + Lock Task Mode (Device Owner)
1. Siapkan proyek Capacitor di direktori terpisah atau di root setelah `npm run build`:
   ```bash
   npm install @capacitor/core @capacitor/cli @capacitor/android
   cp android-capacitor/capacitor.config.ts ./
   npx cap add android
   npx cap sync android
   ```
2. Salin `android-capacitor/KioskLockPlugin.java` dan `android-capacitor/AdminReceiver.java` ke `android/app/src/main/java/id/sch/securequiz/kiosk/`.
3. Daftarkan plugin di `MainActivity.java` (`registerPlugin(KioskLockPlugin.class);`) dan terapkan konfigurasi dari `android-capacitor/AndroidManifest.snippet.xml` (termasuk `android:resizeableActivity="false"` untuk menonaktifkan split-screen OS).
4. Buat file `android/app/src/main/res/xml/device_admin_receiver.xml` berisi `<device-admin><uses-policies /></device-admin>`.
5. Untuk perangkat tablet/HP lab sekolah (kondisi factory-reset / tanpa akun Google di perangkat):
   ```bash
   adb install app-release.apk
   adb shell dpm set-device-owner id.sch.securequiz.kiosk/.AdminReceiver
   ```
6. Dengan Device Owner aktif, `KioskLock.enableExamLock()` mengaktifkan `FLAG_SECURE` (blokir screenshot/screen recording) dan `startLockTask()` (kunci tombol Home, Back, Recent Apps, dan panel notifikasi).

---

## 7. Transparansi Batasan Keamanan Web
- **Web/PWA**: Mampu mengaktifkan Fullscreen API, memblokir seleksi teks/copy/paste/klik kanan/pintasan DevTools, mendeteksi perpindahan tab (`visibilitychange`) dan kehilangan fokus (`blur`), mendeteksi penyusutan viewport (indikasi split-screen), serta memvalidasi waktu & nilai di server.
- **Keterbatasan Browser**: Aplikasi web standar tidak dapat mencegah tangkapan layar sistem operasi, pintasan hardware (Power + Volume), atau penguncian tombol sistem tanpa aplikasi native Android Device Owner.
