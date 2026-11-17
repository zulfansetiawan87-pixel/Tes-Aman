import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { QuizAttempt, QuizDocument } from '../types/quiz.ts';

function formatDateTime(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('id-ID', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export function exportResultsToExcel(
  quiz: QuizDocument,
  attempts: QuizAttempt[],
  receiptValidity: Record<string, boolean>
): void {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Student Grades & Security Summary
  const summaryRows = attempts.map((a, idx) => ({
    No: idx + 1,
    NIS: a.nis,
    Nama_Murid: a.studentName,
    Kelas: a.className,
    Status: a.status,
    Skor_Objektif: a.objectiveScore,
    Skor_Uraian_Manual: a.manualScore,
    Total_Skor: a.totalScore,
    Skor_Maksimal: a.maxScore,
    Persentase: a.maxScore > 0 ? Math.round((a.totalScore / a.maxScore) * 1000) / 10 : 0,
    Jumlah_Pelanggaran: a.violationCount,
    Kumpul_Otomatis: a.autoSubmitted ? 'Ya' : 'Tidak',
    Verifikasi_Server: receiptValidity[a.id] === false ? 'Anomali' : 'Terverifikasi',
    Waktu_Mulai: formatDateTime(a.startedAt),
    Waktu_Selesai: formatDateTime(a.submittedAt),
  }));

  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Rekap Nilai');

  // Sheet 2: Per-Question Item Breakdown
  const itemRows = attempts.flatMap((a) =>
    quiz.questions.map((q) => {
      const res = a.itemResults?.[q.id];
      return {
        NIS: a.nis,
        Nama_Murid: a.studentName,
        Kelas: a.className,
        No_Soal: q.number,
        Tipe: q.type,
        Bobot: q.points,
        Skor_Diperoleh: res ? res.earnedPoints : 0,
        Status_Koreksi: res?.isAutoGraded ? 'Otomatis' : 'Manual',
        Benar: res?.isCorrect === null || res?.isCorrect === undefined ? 'Manual' : res.isCorrect ? 'Ya' : 'Tidak',
      };
    })
  );
  const wsItems = XLSX.utils.json_to_sheet(itemRows);
  XLSX.utils.book_append_sheet(wb, wsItems, 'Rincian Butir');

  // Sheet 3: Item Analysis Statistics
  const analysisRows = quiz.questions.map((q) => {
    const scores = attempts.map((a) => a.itemResults?.[q.id]?.earnedPoints ?? 0);
    const avg = scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
    const difficultyIdx = q.points > 0 ? Math.round((avg / q.points) * 1000) / 10 : 0;
    return {
      No_Soal: q.number,
      Tipe: q.type,
      Pertanyaan: q.prompt.slice(0, 120),
      Bobot_Maksimal: q.points,
      Rata_Rata_Skor: Math.round(avg * 100) / 100,
      Tingkat_Penguasaan_Persen: difficultyIdx,
      Kategori_Kesukaran:
        difficultyIdx >= 70 ? 'Mudah' : difficultyIdx >= 35 ? 'Sedang' : 'Sukar',
    };
  });
  const wsAnalysis = XLSX.utils.json_to_sheet(analysisRows);
  XLSX.utils.book_append_sheet(wb, wsAnalysis, 'Analisis Soal');

  const safeTitle = quiz.title.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
  XLSX.writeFile(wb, `Hasil_${safeTitle}.xlsx`);
}

export function exportResultsToCsv(
  quiz: QuizDocument,
  attempts: QuizAttempt[]
): void {
  const headers = [
    'No',
    'NIS',
    'Nama Murid',
    'Kelas',
    'Status',
    'Skor Objektif',
    'Skor Manual',
    'Total Skor',
    'Skor Maksimal',
    'Persentase (%)',
    'Pelanggaran',
    'Auto Submit',
    'Waktu Mulai',
    'Waktu Selesai',
  ];

  const rows = attempts.map((a, idx) => [
    idx + 1,
    a.nis,
    a.studentName,
    a.className,
    a.status,
    a.objectiveScore,
    a.manualScore,
    a.totalScore,
    a.maxScore,
    a.maxScore > 0 ? Math.round((a.totalScore / a.maxScore) * 1000) / 10 : 0,
    a.violationCount,
    a.autoSubmitted ? 'Ya' : 'Tidak',
    formatDateTime(a.startedAt),
    formatDateTime(a.submittedAt),
  ]);

  const escapeCsv = (val: unknown) => {
    const str = String(val ?? '');
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const csvContent =
    '\uFEFF' +
    [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeTitle = quiz.title.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
  link.href = url;
  link.download = `Hasil_${safeTitle}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportResultsToPdf(
  quiz: QuizDocument,
  attempts: QuizAttempt[],
  receiptValidity: Record<string, boolean>
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFillColor(15, 37, 68);
  doc.rect(0, 0, 297, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.text('LAPORAN HASIL & ANALISIS UJIAN — SECURE QUIZ', 14, 12);
  doc.setFontSize(10);
  doc.text(
    `${quiz.title} | Mata Pelajaran: ${quiz.subject} | Total Peserta: ${attempts.length}`,
    14,
    20
  );

  const avgScore =
    attempts.length > 0
      ? Math.round(
          (attempts.reduce((s, a) => s + a.totalScore, 0) / attempts.length) * 100
        ) / 100
      : 0;
  const maxAchieved =
    attempts.length > 0 ? Math.max(...attempts.map((a) => a.totalScore)) : 0;
  const totalViolations = attempts.reduce((s, a) => s + a.violationCount, 0);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9.5);
  doc.text(
    `Rata-rata Skor: ${avgScore} / ${quiz.totalMaxScore}   |   Nilai Tertinggi: ${maxAchieved}   |   Total Insiden Pengawasan: ${totalViolations}   |   Tanggal Cetak: ${new Date().toLocaleString('id-ID')}`,
    14,
    34
  );

  autoTable(doc, {
    startY: 39,
    head: [
      [
        'No',
        'NIS',
        'Nama Murid',
        'Kelas',
        'Status',
        'Objektif',
        'Uraian',
        'Total',
        '%',
        'Pelanggaran',
        'Integritas',
      ],
    ],
    body: attempts.map((a, idx) => [
      idx + 1,
      a.nis,
      a.studentName,
      a.className,
      a.status === 'graded' ? 'Dinilai' : a.status === 'submitted' ? 'Terkumpul' : 'Aktif',
      a.objectiveScore,
      a.manualScore,
      `${a.totalScore}/${a.maxScore}`,
      `${a.maxScore > 0 ? Math.round((a.totalScore / a.maxScore) * 100) : 0}%`,
      a.violationCount,
      receiptValidity[a.id] === false ? 'Anomali' : 'Valid',
    ]),
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    headStyles: { fillColor: [15, 37, 68], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  doc.addPage();
  doc.setFontSize(13);
  doc.setTextColor(15, 37, 68);
  doc.text('Analisis Butir Soal', 14, 16);

  autoTable(doc, {
    startY: 22,
    head: [['No', 'Tipe', 'Ringkasan Soal', 'Bobot', 'Rata-rata', 'Penguasaan', 'Kategori']],
    body: quiz.questions.map((q) => {
      const scores = attempts.map((a) => a.itemResults?.[q.id]?.earnedPoints ?? 0);
      const avg = scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
      const pct = q.points > 0 ? Math.round((avg / q.points) * 100) : 0;
      const cat = pct >= 70 ? 'Mudah' : pct >= 35 ? 'Sedang' : 'Sukar';
      return [
        q.number,
        q.type,
        q.prompt.slice(0, 85),
        q.points,
        Math.round(avg * 100) / 100,
        `${pct}%`,
        cat,
      ];
    }),
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255 },
  });

  const safeTitle = quiz.title.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
  doc.save(`Laporan_${safeTitle}.pdf`);
}
