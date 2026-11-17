import mammoth from 'mammoth';
import type {
  GroupingCategory,
  GroupingItem,
  ParsedImportQuestion,
  QuestionOption,
  QuestionType,
} from '../types/quiz.ts';

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeQuestionType(raw: string): QuestionType {
  const s = raw.trim().toLowerCase();
  if (s === 'mcq' || s === 'pg' || s === 'pilihan ganda') return 'mcq';
  if (s === 'complex_mcq' || s === 'pgk' || s === 'pilihan ganda kompleks') return 'complex_mcq';
  if (s === 'grouping' || s === 'kelompok' || s === 'mengelompokkan') return 'grouping';
  if (s === 'short_essay' || s === 'isian' || s === 'uraian singkat') return 'short_essay';
  if (s === 'long_essay' || s === 'uraian' || s === 'uraian panjang' || s === 'essay') return 'long_essay';
  return 'mcq';
}

export async function extractTextFromUploadedDocument(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.docx') || mimeType.includes('wordprocessingml')) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }

  if (lower.endsWith('.pdf') || mimeType === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      pages.push(pageText);
    }
    return pages.join('\n');
  }

  // Plain text / markdown fallback
  return buffer.toString('utf8');
}

function parseTaggedBlock(block: string, index: number): ParsedImportQuestion {
  const warnings: string[] = [];
  const getTagValue = (tag: string): string => {
    const regex = new RegExp(`\\[${tag}\\]\\s*([\\s\\S]*?)(?=\\n\\[[A-Z_]+\\]|$)`, 'i');
    const m = block.match(regex);
    return m ? m[1].trim() : '';
  };

  const rawType = getTagValue('TYPE');
  const type = normalizeQuestionType(rawType || 'mcq');
  if (!rawType) warnings.push('Tag [TYPE] tidak ditemukan; diasumsikan Pilihan Ganda.');

  const rawPoints = getTagValue('POINTS');
  const parsedPoints = Number(rawPoints);
  const points = Number.isFinite(parsedPoints) && parsedPoints > 0 ? parsedPoints : 10;
  if (!rawPoints || !Number.isFinite(parsedPoints)) {
    warnings.push('Tag [POINTS] tidak valid; default 10 poin.');
  }

  const stimulusText = getTagValue('STIMULUS_TEXT');
  const stimulusImageUrl = getTagValue('STIMULUS_IMAGE');
  const stimulusAudioUrl = getTagValue('STIMULUS_AUDIO');
  const stimulusCaption = getTagValue('STIMULUS_CAPTION');
  const prompt = getTagValue('PROMPT');
  const rubricNotes = getTagValue('RUBRIC');

  if (!prompt) {
    warnings.push(`Soal #${index + 1}: teks pertanyaan [PROMPT] kosong.`);
  }

  const options: QuestionOption[] = [];
  const rawOptions = getTagValue('OPTIONS');
  if (rawOptions) {
    const optLines = rawOptions.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of optLines) {
      const m = line.match(/^([A-Ha-h])[.):\-\s]+(.+)$/);
      if (m) {
        options.push({
          id: `opt_${m[1].toUpperCase()}`,
          label: m[1].toUpperCase(),
          text: m[2].trim(),
        });
      } else {
        const label = String.fromCharCode(65 + options.length);
        options.push({
          id: `opt_${label}`,
          label,
          text: line,
        });
      }
    }
  }

  const categories: GroupingCategory[] = [];
  const items: GroupingItem[] = [];
  const correctMapping: Record<string, string> = {};

  if (type === 'grouping') {
    const rawCats = getTagValue('CATEGORIES');
    const catNames = rawCats
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    for (const name of catNames) {
      categories.push({ id: uid('cat'), label: name });
    }
    const rawItems = getTagValue('ITEMS');
    const itemLines = rawItems.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of itemLines) {
      const cleaned = line.replace(/^\d+[.)]\s*/, '');
      const arrowParts = cleaned.split(/=>|->|\|/);
      if (arrowParts.length >= 2) {
        const itemText = arrowParts[0].trim();
        const catTarget = arrowParts[1].trim();
        let cat = categories.find((c) => c.label.toLowerCase() === catTarget.toLowerCase());
        if (!cat) {
          cat = { id: uid('cat'), label: catTarget };
          categories.push(cat);
        }
        const itemId = uid('itm');
        items.push({ id: itemId, text: itemText });
        correctMapping[itemId] = cat.id;
      } else {
        items.push({ id: uid('itm'), text: cleaned });
        warnings.push(`Item pengelompokan "${cleaned}" belum memiliki pemetaan "=> Kategori".`);
      }
    }
    if (categories.length < 2 || items.length < 1) {
      warnings.push('Soal Mengelompokkan membutuhkan minimal 2 kategori dan 1 item.');
    }
  }

  const rawKey = getTagValue('KEY');
  let correctOptionId = '';
  let correctOptionIds: string[] = [];
  let acceptedAnswers: string[] = [];

  if (type === 'mcq') {
    const k = rawKey.trim().toUpperCase().replace(/[^A-H]/g, '');
    const matched = options.find((o) => o.label === k);
    if (matched) {
      correctOptionId = matched.id;
    } else if (options.length > 0) {
      correctOptionId = options[0].id;
      warnings.push('Kunci jawaban [KEY] Pilihan Ganda perlu diverifikasi manual.');
    }
  } else if (type === 'complex_mcq') {
    const letters = rawKey
      .split(/[,;\s]+/)
      .map((s) => s.trim().toUpperCase().replace(/[^A-H]/g, ''))
      .filter(Boolean);
    correctOptionIds = options
      .filter((o) => letters.includes(o.label))
      .map((o) => o.id);
    if (correctOptionIds.length === 0) {
      warnings.push('Kunci jawaban [KEY] Pilihan Ganda Kompleks belum terbaca.');
    }
  } else if (type === 'short_essay') {
    acceptedAnswers = rawKey
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    if (acceptedAnswers.length === 0) {
      warnings.push('Kunci jawaban [KEY] Uraian Singkat masih kosong.');
    }
  }

  if ((type === 'mcq' || type === 'complex_mcq') && options.length < 2) {
    warnings.push('Opsi jawaban kurang dari 2 pilihan.');
  }

  const confidence: 'high' | 'medium' | 'low' =
    warnings.length === 0 ? 'high' : warnings.length <= 2 ? 'medium' : 'low';

  return {
    tempId: uid('imp'),
    type,
    prompt,
    stimulusText,
    stimulusImageUrl,
    stimulusAudioUrl,
    stimulusCaption,
    options,
    categories,
    items,
    points,
    correctOptionId,
    correctOptionIds,
    correctMapping,
    acceptedAnswers,
    rubricNotes,
    warnings,
    confidence,
  };
}

function parseNumberedFallback(rawText: string): ParsedImportQuestion[] {
  const normalized = rawText.replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n');
  // Split by lines starting with "1." / "2." etc.
  const chunks = normalized.split(/(?=^\s*\d{1,3}[.)]\s+)/m).filter((c) => /^\s*\d{1,3}[.)]\s+/.test(c));
  const results: ParsedImportQuestion[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i].trim();
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    const firstLine = lines[0].replace(/^\d{1,3}[.)]\s+/, '');
    const promptLines: string[] = [firstLine];
    const options: QuestionOption[] = [];
    let keyStr = '';
    let inOptions = false;

    for (let j = 1; j < lines.length; j++) {
      const line = lines[j];
      const keyMatch = line.match(/^(?:kunci|key|jawaban)\s*[:=]\s*(.+)$/i);
      if (keyMatch) {
        keyStr = keyMatch[1].trim();
        continue;
      }
      const optMatch = line.match(/^([A-Ea-e])[.)]\s+(.+)$/);
      if (optMatch) {
        inOptions = true;
        const label = optMatch[1].toUpperCase();
        options.push({ id: `opt_${label}`, label, text: optMatch[2].trim() });
        continue;
      }
      if (!inOptions) {
        promptLines.push(line);
      } else if (options.length > 0) {
        options[options.length - 1].text += ` ${line}`;
      }
    }

    const warnings: string[] = ['Diimpor dengan mode deteksi otomatis (non-template); harap verifikasi tipe & kunci.'];
    let type: QuestionType = 'mcq';
    let correctOptionId = '';
    let correctOptionIds: string[] = [];
    let acceptedAnswers: string[] = [];

    if (options.length === 0) {
      type = keyStr && keyStr.length < 60 ? 'short_essay' : 'long_essay';
      if (keyStr) acceptedAnswers = keyStr.split('|').map((s) => s.trim()).filter(Boolean);
    } else if (keyStr.includes(',')) {
      type = 'complex_mcq';
      const letters = keyStr.split(/[,;\s]+/).map((s) => s.trim().toUpperCase());
      correctOptionIds = options.filter((o) => letters.includes(o.label)).map((o) => o.id);
    } else {
      const letter = keyStr.toUpperCase().replace(/[^A-E]/g, '');
      const matched = options.find((o) => o.label === letter);
      correctOptionId = matched ? matched.id : options[0].id;
      if (!matched) warnings.push('Kunci jawaban tidak ditemukan; default diarahkan ke opsi A.');
    }

    results.push({
      tempId: uid('imp'),
      type,
      prompt: promptLines.join(' '),
      stimulusText: '',
      stimulusImageUrl: '',
      stimulusAudioUrl: '',
      stimulusCaption: '',
      options,
      categories: [],
      items: [],
      points: 10,
      correctOptionId,
      correctOptionIds,
      correctMapping: {},
      acceptedAnswers,
      rubricNotes: '',
      warnings,
      confidence: 'medium',
    });
  }

  return results;
}

export function parseQuestionsFromText(rawText: string): ParsedImportQuestion[] {
  const cleaned = rawText.replace(/\r\n/g, '\n');
  if (/^\s*\[QUESTION\]\s*$/im.test(cleaned)) {
    const blocks = cleaned
      .split(/^\s*\[QUESTION\]\s*$/im)
      .slice(1)
      .map((b) => b.trim())
      .filter(Boolean);
    return blocks.map((b, idx) => parseTaggedBlock(b, idx));
  }
  return parseNumberedFallback(cleaned);
}
