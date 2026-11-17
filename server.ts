import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import multer from 'multer';
import { z } from 'zod';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };
import {
  decryptKeyPack,
  encryptKeyPack,
  signGradingReceipt,
  signStudentSession,
  verifyGradingReceipt,
  verifyStudentSession,
} from './src/server/crypto.ts';
import { generateQuizImportTemplateDocx } from './src/server/docxTemplate.ts';
import { fetchPublishedQuizFromFirestore } from './src/server/firestoreRest.ts';
import { gradeSubmissionOnServer } from './src/server/grading.ts';
import {
  extractTextFromUploadedDocument,
  parseQuestionsFromText,
} from './src/server/importParser.ts';
import type { QuestionKey, StudentAnswerValue } from './src/types/quiz.ts';

dotenv.config();

if (!getApps().length) {
  initializeApp({ projectId: firebaseConfig.projectId });
}
const adminAuth = getAuth();

const BOOTSTRAPPED_ADMIN_EMAIL = 'zulfansetiawan87@guru.smk.belajar.id';
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '15mb' }));
app.use(cookieParser());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

interface AuthedRequest extends express.Request {
  adminUser?: {
    uid: string;
    email: string;
  };
}

async function verifyAdminAuth(
  req: AuthedRequest,
  res: express.Response,
  next: express.NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token otentikasi admin tidak ditemukan.' });
    return;
  }

  const idToken = authHeader.slice('Bearer '.length).trim();
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    if (!decoded.email || decoded.email_verified !== true) {
      res.status(403).json({ error: 'Email akun Google harus terverifikasi.' });
      return;
    }

    const emailLower = decoded.email.toLowerCase();
    let authorized = emailLower === BOOTSTRAPPED_ADMIN_EMAIL;

    if (!authorized) {
      // Check Firestore /admins/{uid} via REST using the caller's own ID token
      const adminDocUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        firebaseConfig.projectId
      )}/databases/${encodeURIComponent(
        firebaseConfig.firestoreDatabaseId
      )}/documents/admins/${encodeURIComponent(decoded.uid)}`;
      const resp = await fetch(adminDocUrl, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      authorized = resp.ok;
    }

    if (!authorized) {
      res.status(403).json({ error: 'Akun ini tidak terdaftar sebagai Admin/Guru pengawas.' });
      return;
    }

    req.adminUser = { uid: decoded.uid, email: emailLower };
    next();
  } catch (err) {
    console.error('Admin token verification failed:', err);
    res.status(401).json({ error: 'Sesi otentikasi admin tidak valid atau kedaluwarsa.' });
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, serverNow: Date.now(), iso: new Date().toISOString() });
});

app.get('/api/student/time', (_req, res) => {
  res.json({ serverNow: Date.now() });
});

// Seal answer keys with AES-256-GCM before persisting public quiz metadata
const SealKeysSchema = z.object({
  quizId: z.string().min(1).max(128),
  keys: z.array(
    z.object({
      questionId: z.string().min(1),
      type: z.enum(['mcq', 'complex_mcq', 'grouping', 'short_essay', 'long_essay']),
      points: z.number().min(0).max(1000),
      correctOptionId: z.string().optional(),
      correctOptionIds: z.array(z.string()).optional(),
      correctMapping: z.record(z.string(), z.string()).optional(),
      acceptedAnswers: z.array(z.string()).optional(),
      rubricKeywords: z.array(z.string()).optional(),
      rubricNotes: z.string().optional(),
    })
  ),
});

app.post('/api/admin/seal-keys', verifyAdminAuth, (req: AuthedRequest, res) => {
  const parsed = SealKeysSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Format kunci jawaban tidak valid.', details: parsed.error.flatten() });
    return;
  }
  const sealedKeyPack = encryptKeyPack({
    quizId: parsed.data.quizId,
    keys: parsed.data.keys,
    sealedAt: Date.now(),
    sealedBy: req.adminUser?.uid,
  });
  res.json({ sealedKeyPack });
});

app.post('/api/admin/unseal-keys', verifyAdminAuth, (req: AuthedRequest, res) => {
  const { sealedKeyPack } = req.body as { sealedKeyPack?: string };
  if (!sealedKeyPack || typeof sealedKeyPack !== 'string') {
    res.status(400).json({ error: 'sealedKeyPack wajib disertakan.' });
    return;
  }
  try {
    const unsealed = decryptKeyPack<{ quizId: string; keys: QuestionKey[] }>(sealedKeyPack);
    res.json({ keys: unsealed.keys });
  } catch {
    res.status(400).json({ error: 'Gagal mendekripsi sealedKeyPack.' });
  }
});

const VerifyReceiptsSchema = z.object({
  attempts: z.array(
    z.object({
      id: z.string(),
      quizId: z.string(),
      nis: z.string(),
      className: z.string(),
      startedAt: z.string(),
      submittedAt: z.string().optional(),
      objectiveScore: z.number(),
      maxObjectiveScore: z.number(),
      maxScore: z.number(),
      sessionNonce: z.string(),
      serverReceipt: z.string(),
    })
  ),
});

app.post('/api/admin/verify-receipts', verifyAdminAuth, (req, res) => {
  const parsed = VerifyReceiptsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Payload verifikasi receipt tidak valid.' });
    return;
  }
  const results: Record<string, boolean> = {};
  for (const att of parsed.data.attempts) {
    if (!att.submittedAt || !att.serverReceipt) {
      results[att.id] = false;
      continue;
    }
    results[att.id] = verifyGradingReceipt(
      {
        attemptId: att.id,
        quizId: att.quizId,
        nis: att.nis,
        className: att.className,
        startedAt: att.startedAt,
        submittedAt: att.submittedAt,
        objectiveScore: att.objectiveScore,
        maxObjectiveScore: att.maxObjectiveScore,
        maxScore: att.maxScore,
        sessionNonce: att.sessionNonce,
      },
      att.serverReceipt
    );
  }
  res.json({ results });
});

app.get('/api/import/template.docx', async (_req, res) => {
  try {
    const buffer = await generateQuizImportTemplateDocx();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="Template_Impor_Soal_SecureQuiz.docx"'
    );
    res.send(buffer);
  } catch (err) {
    console.error('Failed to generate DOCX template:', err);
    res.status(500).json({ error: 'Gagal membuat template DOCX.' });
  }
});

app.post(
  '/api/import/parse',
  verifyAdminAuth,
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'File DOCX atau PDF belum diunggah.' });
        return;
      }
      const rawText = await extractTextFromUploadedDocument(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
      const questions = parseQuestionsFromText(rawText);
      res.json({
        filename: req.file.originalname,
        extractedChars: rawText.length,
        questions,
      });
    } catch (err) {
      console.error('Document parse error:', err);
      res.status(500).json({
        error: 'Gagal membaca isi dokumen DOCX/PDF. Pastikan file tidak terenkripsi password.',
      });
    }
  }
);

const StartSessionSchema = z.object({
  quizId: z.string().min(1).max(128),
  studentName: z.string().trim().min(2).max(120),
  nis: z.string().trim().min(1).max(40),
  className: z.string().trim().min(1).max(60),
});

app.post('/api/student/session/start', async (req, res) => {
  const parsed = StartSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Data identitas murid (Nama, NIS, Kelas) wajib lengkap.' });
    return;
  }

  try {
    const quiz = await fetchPublishedQuizFromFirestore(parsed.data.quizId);
    if (!quiz || quiz.status !== 'published') {
      res.status(404).json({ error: 'Kuis tidak ditemukan atau belum dipublikasikan.' });
      return;
    }

    const normStudentClass = parsed.data.className.trim().toLowerCase();
    const classAllowed = (quiz.classTargets || []).some((target) => {
      const t = target.trim().toLowerCase();
      return t === 'semua' || t === 'all' || t === normStudentClass;
    });
    if (!classAllowed) {
      res.status(403).json({
        error: `Kuis ini tidak dijadwalkan untuk kelas ${parsed.data.className}.`,
      });
      return;
    }

    const serverNow = Date.now();
    const startMs = Date.parse(quiz.startAt);
    const endMs = Date.parse(quiz.endAt);
    if (Number.isFinite(startMs) && serverNow < startMs) {
      res.status(403).json({ error: 'Jadwal ujian belum dibuka oleh guru pengawas.' });
      return;
    }
    if (Number.isFinite(endMs) && serverNow > endMs) {
      res.status(403).json({ error: 'Jadwal ujian sudah berakhir.' });
      return;
    }

    const durationMs = Math.max(1, Number(quiz.durationMinutes || 30)) * 60 * 1000;
    const expiresAtMs = Number.isFinite(endMs)
      ? Math.min(serverNow + durationMs, endMs)
      : serverNow + durationMs;

    const attemptId = `att_${crypto.randomBytes(16).toString('hex')}`;
    const sessionNonce = crypto.randomBytes(16).toString('hex');

    const sessionToken = signStudentSession({
      attemptId,
      quizId: quiz.id,
      studentName: parsed.data.studentName,
      nis: parsed.data.nis,
      className: parsed.data.className,
      startedAtMs: serverNow,
      expiresAtMs,
      sessionNonce,
    });

    res.cookie('sq_session', sessionToken, {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      maxAge: Math.max(durationMs + 300_000, 3600_000),
    });

    // Return sanitized quiz WITHOUT sealedKeyPack
    const { sealedKeyPack: _omit, ...safeQuiz } = quiz;
    res.json({
      attemptId,
      sessionToken,
      sessionNonce,
      startedAt: new Date(serverNow).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      serverNow,
      quiz: safeQuiz,
    });
  } catch (err) {
    console.error('Session start error:', err);
    res.status(500).json({ error: 'Terjadi kesalahan saat memulai sesi ujian.' });
  }
});

const SubmitAttemptSchema = z.object({
  sessionToken: z.string().min(10).optional(),
  answers: z.record(z.string(), z.any()),
  autoSubmitted: z.boolean().optional(),
});

app.post('/api/student/attempt/submit', async (req, res) => {
  const parsed = SubmitAttemptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Payload pengumpulan jawaban tidak valid.' });
    return;
  }

  const token = parsed.data.sessionToken || (req.cookies?.sq_session as string | undefined);
  const session = token ? verifyStudentSession(token) : null;
  if (!session) {
    res.status(401).json({ error: 'Token sesi ujian tidak valid atau dimodifikasi.' });
    return;
  }

  const serverNow = Date.now();
  // 25-second network grace window for client auto-submit on timeout
  const GRACE_MS = 25_000;
  if (serverNow > session.expiresAtMs + GRACE_MS) {
    res.status(403).json({
      error: 'Batas waktu ujian telah melampaui toleransi server.',
    });
    return;
  }

  try {
    const quiz = await fetchPublishedQuizFromFirestore(session.quizId);
    if (!quiz || !quiz.sealedKeyPack) {
      res.status(404).json({ error: 'Data kunci tersegel kuis tidak ditemukan.' });
      return;
    }

    const unsealed = decryptKeyPack<{ quizId: string; keys: QuestionKey[] }>(quiz.sealedKeyPack);
    if (unsealed.quizId !== quiz.id) {
      res.status(400).json({ error: 'Kecocokan identitas kunci kuis gagal diverifikasi.' });
      return;
    }

    const caseMap: Record<string, boolean> = {};
    for (const q of quiz.questions || []) {
      caseMap[q.id] = Boolean(q.caseSensitive);
    }

    const grading = gradeSubmissionOnServer(
      unsealed.keys,
      parsed.data.answers as Record<string, StudentAnswerValue>,
      caseMap
    );

    const startedAtIso = new Date(session.startedAtMs).toISOString();
    const submittedAtIso = new Date(serverNow).toISOString();
    const effectiveAutoSubmit =
      Boolean(parsed.data.autoSubmitted) || serverNow >= session.expiresAtMs;

    const serverReceipt = signGradingReceipt({
      attemptId: session.attemptId,
      quizId: session.quizId,
      nis: session.nis,
      className: session.className,
      startedAt: startedAtIso,
      submittedAt: submittedAtIso,
      objectiveScore: grading.objectiveScore,
      maxObjectiveScore: grading.maxObjectiveScore,
      maxScore: grading.maxScore,
      sessionNonce: session.sessionNonce,
    });

    res.json({
      attemptId: session.attemptId,
      submittedAt: submittedAtIso,
      autoSubmitted: effectiveAutoSubmit,
      objectiveScore: grading.objectiveScore,
      maxObjectiveScore: grading.maxObjectiveScore,
      maxManualScore: grading.maxManualScore,
      totalScore: grading.objectiveScore,
      maxScore: grading.maxScore,
      itemResults: grading.itemResults,
      serverReceipt,
    });
  } catch (err) {
    console.error('Submit grading error:', err);
    res.status(500).json({ error: 'Gagal memproses penilaian server.' });
  }
});

const DISABLED_HMR_CLIENT_JS = `
const sheetsMap = new Map();
const linkSheetsMap = new Map();
if (typeof document !== 'undefined') {
  document.querySelectorAll('style[data-vite-dev-id]').forEach((el) => {
    sheetsMap.set(el.getAttribute('data-vite-dev-id'), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute('data-vite-dev-id'), el);
  });
}
let lastInsertedStyle;
export function updateStyle(id, content) {
  if (linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => { lastInsertedStyle = undefined; }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement('afterend', style);
    }
    lastInsertedStyle = style;
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  if (linkSheetsMap.has(id)) {
    document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id="' + CSS.escape(id) + '"]').forEach((el) => el.remove());
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    decline() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const parsed = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (parsed.search ? '&' + parsed.search.slice(1) : '') + (parsed.hash || '');
}
export class ErrorOverlay extends HTMLElement {}
`;

async function startServer() {
  const httpServer = http.createServer(app);
  const hmrDisabled = process.env.DISABLE_HMR === 'true';

  if (!isProduction) {
    if (hmrDisabled) {
      app.get('/@vite/client', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(DISABLED_HMR_CLIENT_JS);
      });
    }

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: hmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`SECURE QUIZ server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
