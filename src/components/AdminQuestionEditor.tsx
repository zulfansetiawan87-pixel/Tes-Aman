import React from 'react';
import {
  BookMarked,
  Check,
  Image as ImageIcon,
  Music,
  Plus,
  Trash2,
} from 'lucide-react';
import type { FullQuestion, QuestionType } from '../types/quiz.ts';

interface AdminQuestionEditorProps {
  question: FullQuestion;
  index: number;
  onChange: (updated: FullQuestion) => void;
  onDelete: () => void;
  onSaveToBank?: () => void;
}

const TYPE_OPTIONS: Array<{ value: QuestionType; label: string }> = [
  { value: 'mcq', label: 'Pilihan Ganda' },
  { value: 'complex_mcq', label: 'Pilihan Ganda Kompleks' },
  { value: 'grouping', label: 'Mengelompokkan' },
  { value: 'short_essay', label: 'Uraian Singkat' },
  { value: 'long_essay', label: 'Uraian Panjang' },
];

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

async function compressImageToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxW = 960;
        const scale = img.width > maxW ? maxW / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export const AdminQuestionEditor: React.FC<AdminQuestionEditorProps> = ({
  question,
  index,
  onChange,
  onDelete,
  onSaveToBank,
}) => {
  const handleTypeChange = (nextType: QuestionType) => {
    const base: FullQuestion = { ...question, type: nextType };
    if ((nextType === 'mcq' || nextType === 'complex_mcq') && (!base.options || base.options.length === 0)) {
      base.options = [
        { id: 'opt_A', label: 'A', text: '' },
        { id: 'opt_B', label: 'B', text: '' },
        { id: 'opt_C', label: 'C', text: '' },
        { id: 'opt_D', label: 'D', text: '' },
      ];
      base.correctOptionId = 'opt_A';
      base.correctOptionIds = ['opt_A'];
    }
    if (nextType === 'grouping' && (!base.categories || base.categories.length === 0)) {
      const c1 = { id: uid('cat'), label: 'Kategori 1' };
      const c2 = { id: uid('cat'), label: 'Kategori 2' };
      const i1 = { id: uid('itm'), text: 'Pernyataan 1' };
      base.categories = [c1, c2];
      base.items = [i1];
      base.correctMapping = { [i1.id]: c1.id };
    }
    if (nextType === 'short_essay' && !base.acceptedAnswers) {
      base.acceptedAnswers = [''];
    }
    onChange(base);
  };

  const handleImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file);
      onChange({ ...question, stimulusImageUrl: dataUrl });
    } catch {
      // ignore invalid image
    }
  };

  const handleAudioFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 450 * 1024) {
      alert('Ukuran file audio unggahan langsung maksimal 450 KB agar muat di dokumen kuis. Untuk audio besar, gunakan tautan URL eksternal.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      onChange({ ...question, stimulusAudioUrl: String(reader.result) });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0F2544] font-mono text-xs font-bold text-white">
            {index + 1}
          </span>

          <select
            value={question.type}
            onChange={(e) => handleTypeChange(e.target.value as QuestionType)}
            className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 focus:border-blue-600 focus:outline-none"
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span>Skor:</span>
            <input
              type="number"
              min={0}
              max={1000}
              value={question.points}
              onChange={(e) =>
                onChange({ ...question, points: Math.max(0, Number(e.target.value) || 0) })
              }
              className="w-20 min-h-[38px] rounded-lg border border-slate-300 px-2.5 font-mono text-xs font-semibold text-slate-900"
            />
          </label>
        </div>

        <div className="flex items-center gap-2">
          {onSaveToBank && (
            <button
              type="button"
              onClick={onSaveToBank}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              <BookMarked className="h-3.5 w-3.5 text-blue-600" />
              <span>Simpan ke Bank</span>
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 text-xs font-medium text-red-700 hover:bg-red-100 cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Hapus</span>
          </button>
        </div>
      </div>

      {/* Multimodal Stimulus Panel */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-700">
          Stimulus Multimodal (Teks Bacaan / Gambar / Audio Listening Bahasa Inggris — Opsional)
        </p>

        <textarea
          rows={3}
          value={question.stimulusText || ''}
          onChange={(e) => onChange({ ...question, stimulusText: e.target.value })}
          placeholder="Tempelkan teks bacaan, pengumuman, dialog, atau konteks multimodal di sini..."
          className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs leading-relaxed text-slate-800 focus:border-blue-600 focus:outline-none"
        />

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-[11px] font-medium text-slate-600">
              URL Gambar atau Unggah Gambar
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={question.stimulusImageUrl || ''}
                onChange={(e) => onChange({ ...question, stimulusImageUrl: e.target.value })}
                placeholder="https://... atau /src/assets/images/..."
                className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
              />
              <label className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0">
                <ImageIcon className="h-3.5 w-3.5 text-blue-600" />
                <span>Pilih</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => void handleImageFile(e)} />
              </label>
            </div>
            <input
              type="text"
              value={question.stimulusCaption || ''}
              onChange={(e) => onChange({ ...question, stimulusCaption: e.target.value })}
              placeholder="Keterangan gambar (opsional)"
              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-[11px] font-medium text-slate-600">
              URL Audio Listening atau Unggah Audio (&le;450KB)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={question.stimulusAudioUrl || ''}
                onChange={(e) => onChange({ ...question, stimulusAudioUrl: e.target.value })}
                placeholder="https://.../listening.mp3"
                className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
              />
              <label className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0">
                <Music className="h-3.5 w-3.5 text-orange-600" />
                <span>Audio</span>
                <input type="file" accept="audio/*" className="hidden" onChange={handleAudioFile} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-slate-600">
              <span>Batas Putar Audio (0 = bebas):</span>
              <input
                type="number"
                min={0}
                max={10}
                value={question.audioPlayLimit || 0}
                onChange={(e) =>
                  onChange({ ...question, audioPlayLimit: Math.max(0, Number(e.target.value) || 0) })
                }
                className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1 font-mono text-xs"
              />
            </label>
          </div>
        </div>
      </div>

      {/* Question Prompt */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
          Pertanyaan / Instruksi Soal
        </label>
        <textarea
          rows={2}
          value={question.prompt}
          onChange={(e) => onChange({ ...question, prompt: e.target.value })}
          placeholder="Tuliskan pertanyaan inti di sini..."
          className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
        />
      </div>

      {/* Type-Specific Editors */}
      {(question.type === 'mcq' || question.type === 'complex_mcq') && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">
              Pilihan Jawaban & Kunci ({question.type === 'mcq' ? 'Pilih 1 kunci' : 'Centang semua kunci benar'})
            </span>
            <button
              type="button"
              onClick={() => {
                const opts = question.options || [];
                const nextLabel = String.fromCharCode(65 + opts.length);
                onChange({
                  ...question,
                  options: [...opts, { id: `opt_${nextLabel}_${Date.now()}`, label: nextLabel, text: '' }],
                });
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Tambah Opsi</span>
            </button>
          </div>

          {(question.options || []).map((opt, oIdx) => {
            const isCorrect =
              question.type === 'mcq'
                ? question.correctOptionId === opt.id
                : (question.correctOptionIds || []).includes(opt.id);

            return (
              <div key={opt.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (question.type === 'mcq') {
                      onChange({ ...question, correctOptionId: opt.id });
                    } else {
                      const prev = question.correctOptionIds || [];
                      const next = isCorrect
                        ? prev.filter((id) => id !== opt.id)
                        : [...prev, opt.id];
                      onChange({ ...question, correctOptionIds: next });
                    }
                  }}
                  title="Tandai sebagai kunci jawaban"
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-bold cursor-pointer ${
                    isCorrect
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {isCorrect ? <Check className="h-4 w-4" /> : opt.label}
                </button>
                <input
                  type="text"
                  value={opt.text}
                  onChange={(e) => {
                    const nextOpts = [...(question.options || [])];
                    nextOpts[oIdx] = { ...opt, text: e.target.value };
                    onChange({ ...question, options: nextOpts });
                  }}
                  placeholder={`Teks pilihan ${opt.label}`}
                  className="flex-1 min-h-[38px] rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
                />
                {(question.options || []).length > 2 && (
                  <button
                    type="button"
                    onClick={() => {
                      const nextOpts = (question.options || []).filter((o) => o.id !== opt.id);
                      onChange({ ...question, options: nextOpts });
                    }}
                    className="rounded-lg p-2 text-slate-400 hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {question.type === 'grouping' && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">Daftar Kategori</span>
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...question,
                    categories: [
                      ...(question.categories || []),
                      { id: uid('cat'), label: `Kategori ${(question.categories?.length || 0) + 1}` },
                    ],
                  })
                }
                className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
              >
                + Kategori
              </button>
            </div>
            {(question.categories || []).map((cat, cIdx) => (
              <div key={cat.id} className="flex items-center gap-2">
                <input
                  type="text"
                  value={cat.label}
                  onChange={(e) => {
                    const next = [...(question.categories || [])];
                    next[cIdx] = { ...cat, label: e.target.value };
                    onChange({ ...question, categories: next });
                  }}
                  className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...question,
                      categories: (question.categories || []).filter((c) => c.id !== cat.id),
                    })
                  }
                  className="text-slate-400 hover:text-red-600 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-slate-200 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">Item & Kategori Benar</span>
              <button
                type="button"
                onClick={() => {
                  const newItem = { id: uid('itm'), text: '' };
                  const defaultCat = question.categories?.[0]?.id || '';
                  onChange({
                    ...question,
                    items: [...(question.items || []), newItem],
                    correctMapping: { ...(question.correctMapping || {}), [newItem.id]: defaultCat },
                  });
                }}
                className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
              >
                + Item
              </button>
            </div>
            {(question.items || []).map((itm, iIdx) => (
              <div key={itm.id} className="flex flex-col gap-1.5 rounded-lg bg-slate-50 p-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={itm.text}
                    onChange={(e) => {
                      const next = [...(question.items || [])];
                      next[iIdx] = { ...itm, text: e.target.value };
                      onChange({ ...question, items: next });
                    }}
                    placeholder="Teks item..."
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const nextMap = { ...(question.correctMapping || {}) };
                      delete nextMap[itm.id];
                      onChange({
                        ...question,
                        items: (question.items || []).filter((x) => x.id !== itm.id),
                        correctMapping: nextMap,
                      });
                    }}
                    className="text-slate-400 hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <select
                  value={question.correctMapping?.[itm.id] || ''}
                  onChange={(e) =>
                    onChange({
                      ...question,
                      correctMapping: { ...(question.correctMapping || {}), [itm.id]: e.target.value },
                    })
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                >
                  <option value="">-- Pilih Kunci Kategori --</option>
                  {(question.categories || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {question.type === 'short_essay' && (
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate-700">
            Variasi Jawaban Benar (pisahkan dengan tanda <span className="font-mono">|</span> untuk beberapa sinonim/ejaan)
          </label>
          <input
            type="text"
            value={(question.acceptedAnswers || []).join(' | ')}
            onChange={(e) =>
              onChange({
                ...question,
                acceptedAnswers: e.target.value.split('|').map((s) => s.trim()),
              })
            }
            placeholder="Contoh: will be organized | will be organised"
            className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-sm"
          />
          <label className="inline-flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={Boolean(question.caseSensitive)}
              onChange={(e) => onChange({ ...question, caseSensitive: e.target.checked })}
            />
            <span>Peka huruf besar/kecil (case-sensitive)</span>
          </label>
        </div>
      )}

      {question.type === 'long_essay' && (
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Rubrik Penilaian Guru (Hanya tampil di Panel Penilaian Admin)
          </label>
          <textarea
            rows={2}
            value={question.rubricNotes || ''}
            onChange={(e) => onChange({ ...question, rubricNotes: e.target.value })}
            placeholder="Contoh: Skor maksimal bila menyertakan tesis, 2 bukti pendukung, dan grammar tepat..."
            className="w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs text-slate-800"
          />
        </div>
      )}
    </div>
  );
};
