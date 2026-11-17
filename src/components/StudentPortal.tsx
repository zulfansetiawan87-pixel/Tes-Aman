import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Flag,
  Grid,
  Lock,
  Maximize2,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import { useExamSecurity } from '../hooks/useExamSecurity.ts';
import {
  autosaveAttemptProgress,
  createAttemptInFirestore,
  finalizeAttemptInFirestore,
  getAttemptById,
  listPublishedQuizzesForStudent,
  logViolationEvent,
} from '../lib/firestoreApi.ts';
import type {
  PublicQuestion,
  QuizAttempt,
  QuizDocument,
  StudentAnswerValue,
  ViolationSummaryEntry,
  ViolationType,
} from '../types/quiz.ts';
import { AudioStimulusPlayer } from './AudioStimulusPlayer.tsx';

interface LocalSessionSnapshot {
  attemptId: string;
  quizId: string;
  quizTitle: string;
  sessionToken: string;
  sessionNonce: string;
  studentName: string;
  nis: string;
  className: string;
  startedAt: string;
  expiresAt: string;
  answers: Record<string, StudentAnswerValue>;
  flaggedQuestions: string[];
  currentQuestionIndex: number;
  violationCount: number;
  violationsSummary: ViolationSummaryEntry[];
  quiz: Omit<QuizDocument, 'sealedKeyPack'>;
}

const LOCAL_SESSION_KEY = 'secure_quiz_active_session_v1';
const LOCAL_PROFILE_KEY = 'secure_quiz_student_profile_v1';

const QUESTION_TYPE_LABELS: Record<PublicQuestion['type'], string> = {
  mcq: 'Pilihan Ganda',
  complex_mcq: 'Pilihan Ganda Kompleks',
  grouping: 'Mengelompokkan',
  short_essay: 'Uraian Singkat',
  long_essay: 'Uraian Panjang',
};

function isQuestionAnswered(
  q: PublicQuestion,
  val: StudentAnswerValue | undefined
): boolean {
  if (val === undefined || val === null) return false;
  if (q.type === 'mcq' || q.type === 'short_essay' || q.type === 'long_essay') {
    return typeof val === 'string' && val.trim().length > 0;
  }
  if (q.type === 'complex_mcq') {
    return Array.isArray(val) && val.length > 0;
  }
  if (q.type === 'grouping') {
    if (typeof val !== 'object' || Array.isArray(val)) return false;
    const totalItems = q.items?.length || 0;
    return totalItems > 0 && Object.keys(val).length === totalItems;
  }
  return false;
}

export const StudentPortal: React.FC = () => {
  const [step, setStep] = useState<'identity' | 'catalog' | 'briefing' | 'exam' | 'submitted'>('identity');

  // Student identity
  const [studentName, setStudentName] = useState<string>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LOCAL_PROFILE_KEY) || '{}');
      return saved.studentName || '';
    } catch {
      return '';
    }
  });
  const [nis, setNis] = useState<string>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LOCAL_PROFILE_KEY) || '{}');
      return saved.nis || '';
    } catch {
      return '';
    }
  });
  const [className, setClassName] = useState<string>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LOCAL_PROFILE_KEY) || '{}');
      return saved.className || '';
    } catch {
      return '';
    }
  });

  // Catalog & selected quiz
  const [quizzes, setQuizzes] = useState<QuizDocument[]>([]);
  const [loadingQuizzes, setLoadingQuizzes] = useState(false);
  const [selectedQuiz, setSelectedQuiz] = useState<QuizDocument | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Active exam session state
  const [recoverableSession, setRecoverableSession] = useState<LocalSessionSnapshot | null>(null);
  const [activeSession, setActiveSession] = useState<LocalSessionSnapshot | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, StudentAnswerValue>>({});
  const [flagged, setFlagged] = useState<string[]>([]);
  const [violationCount, setViolationCount] = useState(0);
  const [violationsSummary, setViolationsSummary] = useState<ViolationSummaryEntry[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [autosaveStatus, setAutosaveStatus] = useState<'saved' | 'saving' | 'offline'>('saved');
  const [showNavDrawer, setShowNavDrawer] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedResult, setSubmittedResult] = useState<{
    attemptId: string;
    objectiveScore: number;
    maxObjectiveScore: number;
    maxManualScore: number;
    maxScore: number;
    autoSubmitted: boolean;
    submittedAt: string;
    serverReceipt: string;
  } | null>(null);

  const autosaveTimerRef = useRef<number | null>(null);
  const submittingRef = useRef(false);

  // Check recoverable active session on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as LocalSessionSnapshot;
      if (parsed && parsed.attemptId && Date.parse(parsed.expiresAt) > Date.now()) {
        // Verify with Firestore if still in_progress
        getAttemptById(parsed.attemptId)
          .then((remote) => {
            if (!remote || remote.status === 'in_progress') {
              setRecoverableSession(parsed);
            } else {
              localStorage.removeItem(LOCAL_SESSION_KEY);
            }
          })
          .catch(() => {
            setRecoverableSession(parsed);
          });
      } else {
        localStorage.removeItem(LOCAL_SESSION_KEY);
      }
    } catch {
      localStorage.removeItem(LOCAL_SESSION_KEY);
    }
  }, []);

  const loadQuizzesForClass = useCallback(async () => {
    setLoadingQuizzes(true);
    setErrorMsg(null);
    try {
      const all = await listPublishedQuizzesForStudent();
      const normClass = className.trim().toLowerCase();
      const filtered = all.filter((q) =>
        (q.classTargets || []).some((t) => {
          const ct = t.trim().toLowerCase();
          return ct === 'semua' || ct === 'all' || ct === normClass;
        })
      );
      setQuizzes(filtered);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat daftar kuis.');
    } finally {
      setLoadingQuizzes(false);
    }
  }, [className]);

  const handleIdentitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName.trim() || !nis.trim() || !className.trim()) {
      setErrorMsg('Harap lengkapi Nama Lengkap, NIS, dan Kelas.');
      return;
    }
    try {
      localStorage.setItem(
        LOCAL_PROFILE_KEY,
        JSON.stringify({
          studentName: studentName.trim(),
          nis: nis.trim(),
          className: className.trim(),
        })
      );
    } catch {
      // ignore storage errors
    }
    setStep('catalog');
    await loadQuizzesForClass();
  };

  const persistLocalSnapshot = useCallback((snapshot: LocalSessionSnapshot) => {
    try {
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(snapshot));
    } catch {
      // ignore quota
    }
  }, []);

  const handleFinalSubmit = useCallback(
    async (autoSubmitted = false) => {
      if (!activeSession || submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      setShowSubmitConfirm(false);

      try {
        const resp = await fetch('/api/student/attempt/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionToken: activeSession.sessionToken,
            answers,
            autoSubmitted,
          }),
        });

        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(data.error || 'Gagal mengumpulkan jawaban ke server.');
        }

        await finalizeAttemptInFirestore(activeSession.attemptId, {
          answers,
          flaggedQuestions: flagged,
          currentQuestionIndex: currentIdx,
          violationCount,
          violationsSummary,
          submittedAt: data.submittedAt,
          autoSubmitted: Boolean(data.autoSubmitted),
          objectiveScore: data.objectiveScore,
          maxObjectiveScore: data.maxObjectiveScore,
          totalScore: data.totalScore,
          maxScore: data.maxScore,
          itemResults: data.itemResults,
          serverReceipt: data.serverReceipt,
        });

        localStorage.removeItem(LOCAL_SESSION_KEY);
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => undefined);
        }

        setSubmittedResult({
          attemptId: activeSession.attemptId,
          objectiveScore: data.objectiveScore,
          maxObjectiveScore: data.maxObjectiveScore,
          maxManualScore: data.maxManualScore,
          maxScore: data.maxScore,
          autoSubmitted: Boolean(data.autoSubmitted),
          submittedAt: data.submittedAt,
          serverReceipt: data.serverReceipt,
        });
        setActiveSession(null);
        setStep('submitted');
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Gagal mengirim jawaban.');
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [activeSession, answers, currentIdx, flagged, violationCount, violationsSummary]
  );

  const handleViolation = useCallback(
    (type: ViolationType, detail: string) => {
      if (!activeSession || step !== 'exam') return;
      const entry: ViolationSummaryEntry = {
        type,
        detail,
        timestamp: new Date().toISOString(),
      };

      setViolationCount((prev) => {
        const nextCount = prev + 1;
        const maxV = activeSession.quiz.maxViolations || 0;
        if (maxV > 0 && nextCount >= maxV) {
          setTimeout(() => {
            void handleFinalSubmit(true);
          }, 900);
        }
        return nextCount;
      });

      setViolationsSummary((prev) => [...prev.slice(-49), entry]);

      void logViolationEvent({
        attemptId: activeSession.attemptId,
        quizId: activeSession.quizId,
        type,
        detail,
      }).catch(() => undefined);
    },
    [activeSession, handleFinalSubmit, step]
  );

  const security = useExamSecurity({
    enabled: step === 'exam' && Boolean(activeSession),
    requireFullscreen: Boolean(activeSession?.quiz.requireFullscreen),
    onViolation: handleViolation,
  });

  // Start new quiz session via server validation
  const startQuizSession = async () => {
    if (!selectedQuiz) return;
    setErrorMsg(null);

    if (selectedQuiz.requireFullscreen) {
      await security.requestFullscreen();
    }

    try {
      const resp = await fetch('/api/student/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quizId: selectedQuiz.id,
          studentName: studentName.trim(),
          nis: nis.trim(),
          className: className.trim(),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Gagal memulai sesi kuis.');
      }

      const quizPayload = data.quiz as Omit<QuizDocument, 'sealedKeyPack'>;
      const questionsList = [...(quizPayload.questions || [])];
      if (quizPayload.shuffleQuestions) {
        for (let i = questionsList.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [questionsList[i], questionsList[j]] = [questionsList[j], questionsList[i]];
        }
      }
      const preparedQuiz = { ...quizPayload, questions: questionsList };

      const initialAttempt: Omit<QuizAttempt, 'createdAt' | 'updatedAt'> = {
        id: data.attemptId,
        quizId: preparedQuiz.id,
        quizTitle: preparedQuiz.title,
        studentName: studentName.trim(),
        nis: nis.trim(),
        className: className.trim(),
        status: 'in_progress',
        startedAt: data.startedAt,
        expiresAt: data.expiresAt,
        autoSubmitted: false,
        answers: {},
        flaggedQuestions: [],
        currentQuestionIndex: 0,
        violationCount: 0,
        violationsSummary: [],
        objectiveScore: 0,
        maxObjectiveScore: 0,
        manualScore: 0,
        maxManualScore: 0,
        totalScore: 0,
        maxScore: preparedQuiz.totalMaxScore,
        itemResults: {},
        manualFeedback: {},
        serverReceipt: '',
        sessionNonce: data.sessionNonce,
      };

      await createAttemptInFirestore(initialAttempt);

      const snapshot: LocalSessionSnapshot = {
        attemptId: data.attemptId,
        quizId: preparedQuiz.id,
        quizTitle: preparedQuiz.title,
        sessionToken: data.sessionToken,
        sessionNonce: data.sessionNonce,
        studentName: studentName.trim(),
        nis: nis.trim(),
        className: className.trim(),
        startedAt: data.startedAt,
        expiresAt: data.expiresAt,
        answers: {},
        flaggedQuestions: [],
        currentQuestionIndex: 0,
        violationCount: 0,
        violationsSummary: [],
        quiz: preparedQuiz,
      };

      setServerOffsetMs(Number(data.serverNow) - Date.now());
      setActiveSession(snapshot);
      setAnswers({});
      setFlagged([]);
      setCurrentIdx(0);
      setViolationCount(0);
      setViolationsSummary([]);
      persistLocalSnapshot(snapshot);
      setStep('exam');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memulai sesi.');
    }
  };

  // Recover active session
  const recoverActiveSession = async () => {
    if (!recoverableSession) return;
    if (recoverableSession.quiz.requireFullscreen) {
      await security.requestFullscreen();
    }
    try {
      const timeResp = await fetch('/api/student/time');
      if (timeResp.ok) {
        const { serverNow } = (await timeResp.json()) as { serverNow: number };
        setServerOffsetMs(serverNow - Date.now());
      }
    } catch {
      // use local offset if offline
    }

    setStudentName(recoverableSession.studentName);
    setNis(recoverableSession.nis);
    setClassName(recoverableSession.className);
    setActiveSession(recoverableSession);
    setAnswers(recoverableSession.answers || {});
    setFlagged(recoverableSession.flaggedQuestions || []);
    setCurrentIdx(recoverableSession.currentQuestionIndex || 0);
    setViolationCount(recoverableSession.violationCount || 0);
    setViolationsSummary(recoverableSession.violationsSummary || []);
    setRecoverableSession(null);
    setStep('exam');
  };

  // Server-synced countdown timer & auto-submit
  useEffect(() => {
    if (step !== 'exam' || !activeSession) return;
    const expiresAtMs = Date.parse(activeSession.expiresAt);

    const tick = () => {
      const estimatedServerNow = Date.now() + serverOffsetMs;
      const rem = Math.max(0, Math.floor((expiresAtMs - estimatedServerNow) / 1000));
      setSecondsLeft(rem);
      if (rem <= 0 && !submittingRef.current) {
        void handleFinalSubmit(true);
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [activeSession, handleFinalSubmit, serverOffsetMs, step]);

  // Autosave to localStorage immediately & Firestore debounced
  useEffect(() => {
    if (step !== 'exam' || !activeSession) return;

    const updated: LocalSessionSnapshot = {
      ...activeSession,
      answers,
      flaggedQuestions: flagged,
      currentQuestionIndex: currentIdx,
      violationCount,
      violationsSummary,
    };
    persistLocalSnapshot(updated);

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    setAutosaveStatus('saving');
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveAttemptProgress(activeSession.attemptId, {
        answers,
        flaggedQuestions: flagged,
        currentQuestionIndex: currentIdx,
        violationCount,
        violationsSummary,
      })
        .then(() => setAutosaveStatus('saved'))
        .catch(() => setAutosaveStatus('offline'));
    }, 1200);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [
    activeSession,
    answers,
    currentIdx,
    flagged,
    persistLocalSnapshot,
    step,
    violationCount,
    violationsSummary,
  ]);

  const currentQuestion: PublicQuestion | null = useMemo(() => {
    if (!activeSession) return null;
    return activeSession.quiz.questions[currentIdx] || null;
  }, [activeSession, currentIdx]);

  const answeredCount = useMemo(() => {
    if (!activeSession) return 0;
    return activeSession.quiz.questions.filter((q) =>
      isQuestionAnswered(q, answers[q.id])
    ).length;
  }, [activeSession, answers]);

  const formatCountdown = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // STEP 1: STUDENT IDENTITY FORM
  if (step === 'identity') {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:py-12">
        {recoverableSession && (
          <div className="mb-6 rounded-2xl border border-orange-300 bg-orange-50 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    Sesi Ujian Aktif Terdeteksi
                  </h3>
                  <p className="mt-1 text-sm text-slate-700">
                    {recoverableSession.quizTitle} · {recoverableSession.studentName} ({recoverableSession.nis} · {recoverableSession.className})
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void recoverActiveSession()}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 cursor-pointer"
                >
                  <RefreshCw className="h-4 w-4" />
                  <span>Pulihkan Sesi</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-12 lg:items-stretch">
          <div className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xs">
            <div className="flex items-center gap-2.5 text-blue-600">
              <UserCheck className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-wider">
                Portal Peserta Ujian
              </span>
            </div>
            <h1 className="mt-2 font-display text-2xl font-bold text-slate-900 sm:text-3xl text-balance">
              Masuk Ruang Ujian Terproteksi
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Masukkan identitas resmi Anda untuk menampilkan jadwal kuis yang sesuai dengan kelas Anda.
            </p>

            {errorMsg && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={(e) => void handleIdentitySubmit(e)} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-800" htmlFor="sq-name">
                  Nama Lengkap Murid
                </label>
                <input
                  id="sq-name"
                  type="text"
                  required
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  placeholder="Contoh: Aulia Rahmawati"
                  className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-800" htmlFor="sq-nis">
                    NIS / Nomor Induk
                  </label>
                  <input
                    id="sq-nis"
                    type="text"
                    required
                    value={nis}
                    onChange={(e) => setNis(e.target.value)}
                    placeholder="Contoh: 2026001"
                    className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-4 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-800" htmlFor="sq-class">
                    Kelas
                  </label>
                  <input
                    id="sq-class"
                    type="text"
                    required
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    placeholder="Contoh: X TJKT 1"
                    className="mt-1.5 w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>
              </div>

              <div className="pt-1">
                <p className="text-xs text-slate-500 mb-2">Pilihan cepat kelas contoh:</p>
                <div className="flex flex-wrap gap-2">
                  {['X TJKT 1', 'X TJKT 2', 'X RPL 1', 'XI RPL 1', 'XII TKJ 1'].map((cls) => (
                    <button
                      key={cls}
                      type="button"
                      onClick={() => setClassName(cls)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                        className === cls
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {cls}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="mt-2 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#0F2544] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 cursor-pointer"
              >
                <span>Lihat Daftar Kuis Kelas</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          </div>

          <div className="lg:col-span-5 flex flex-col justify-between rounded-2xl border border-slate-200 bg-[#0F2544] p-6 sm:p-7 text-white">
            <div>
              <div className="flex items-center gap-2 text-orange-400">
                <ShieldCheck className="h-5 w-5" />
                <span className="text-xs font-semibold uppercase tracking-wider">
                  Protokol Integritas Ujian
                </span>
              </div>
              <h2 className="mt-3 font-display text-xl font-bold text-balance">
                Sistem Pengawasan Terukur & Pemulihan Otomatis
              </h2>
              <ul className="mt-4 space-y-3 text-sm text-slate-200">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                  <span>Jawaban tersimpan otomatis di perangkat dan server setiap perubahan.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                  <span>Timer disinkronkan ke jam server dan otomatis dikumpulkan saat waktu habis.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                  <span>Mode layar penuh, kunci clipboard, dan deteksi perpindahan tab dicatat ke log guru.</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 rounded-xl border border-white/15 bg-white/5 p-4 text-xs leading-relaxed text-slate-300">
              <strong className="text-white">Catatan Transparansi Teknis:</strong> Browser web tidak dapat memblokir tangkapan layar sistem operasi atau tombol perangkat keras. Penguncian tingkat perangkat tersedia melalui aplikasi pendamping Android Device Owner (Lock Task Mode).
            </div>
          </div>
        </div>
      </div>
    );
  }

  // STEP 2: QUIZ CATALOG FOR CLASS
  if (step === 'catalog') {
    const now = Date.now();
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <button
              type="button"
              onClick={() => setStep('identity')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Ubah Identitas</span>
            </button>
            <h1 className="mt-2 font-display text-2xl font-bold text-slate-900">
              Kuis Tersedia untuk Kelas {className}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Peserta: <strong className="text-slate-900">{studentName}</strong> · NIS{' '}
              <span className="font-mono">{nis}</span>
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadQuizzesForClass()}
            disabled={loadingQuizzes}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer self-start"
          >
            <RefreshCw className={`h-4 w-4 ${loadingQuizzes ? 'animate-spin' : ''}`} />
            <span>Segarkan Jadwal</span>
          </button>
        </div>

        {errorMsg && (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        {loadingQuizzes ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-48 animate-pulse rounded-2xl border border-slate-200 bg-white p-6" />
            ))}
          </div>
        ) : quizzes.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <BookOpen className="mx-auto h-10 w-10 text-slate-400" />
            <h2 className="mt-3 font-display text-lg font-semibold text-slate-900">
              Belum Ada Kuis Aktif untuk Kelas {className}
            </h2>
            <p className="mt-1.5 text-sm text-slate-600">
              Pastikan penulisan nama kelas sesuai (misalnya <span className="font-mono">X TJKT 1</span>) atau hubungi guru pengawas untuk mempublikasikan kuis.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            {quizzes.map((quiz) => {
              const startMs = Date.parse(quiz.startAt);
              const endMs = Date.parse(quiz.endAt);
              const isBefore = Number.isFinite(startMs) && now < startMs;
              const isAfter = Number.isFinite(endMs) && now > endMs;
              const isOpen = !isBefore && !isAfter;

              return (
                <article
                  key={quiz.id}
                  className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 transition-colors hover:border-blue-300"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-blue-700">{quiz.subject}</span>
                      <span>·</span>
                      <span className="font-mono tabular-nums">{quiz.questionCount} soal</span>
                      <span>·</span>
                      <span className="font-mono tabular-nums">{quiz.durationMinutes} menit</span>
                    </div>

                    <h2 className="mt-2 font-display text-lg font-bold text-slate-900">
                      {quiz.title}
                    </h2>
                    {quiz.description && (
                      <p className="mt-2 text-sm text-slate-600 line-clamp-2">{quiz.description}</p>
                    )}

                    <div className="mt-4 space-y-1 text-xs text-slate-500">
                      <p>
                        Jadwal:{' '}
                        <span className="font-medium text-slate-700">
                          {new Date(quiz.startAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>{' '}
                        s/d{' '}
                        <span className="font-medium text-slate-700">
                          {new Date(quiz.endAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                      </p>
                      <p className="flex items-center gap-1.5">
                        {isOpen ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            <span className="font-semibold text-emerald-700">Status: Sedang Berlangsung</span>
                          </>
                        ) : isBefore ? (
                          <>
                            <Clock className="h-3.5 w-3.5 text-orange-600" />
                            <span className="font-semibold text-orange-700">Status: Belum Dibuka</span>
                          </>
                        ) : (
                          <>
                            <Lock className="h-3.5 w-3.5 text-slate-500" />
                            <span className="font-semibold text-slate-600">Status: Jadwal Berakhir</span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={!isOpen}
                    onClick={() => {
                      setSelectedQuiz(quiz);
                      setErrorMsg(null);
                      setStep('briefing');
                    }}
                    className={`mt-5 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors cursor-pointer ${
                      isOpen
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    <span>{isOpen ? 'Baca Petunjuk & Mulai' : 'Tidak Tersedia Saat Ini'}</span>
                    {isOpen && <ArrowRight className="h-4 w-4" />}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // STEP 3: PRE-EXAM INSTRUCTIONS & FULLSCREEN CONSENT
  if (step === 'briefing' && selectedQuiz) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <button
          type="button"
          onClick={() => setStep('catalog')}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Kembali ke Daftar Kuis</span>
        </button>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xs">
          <div className="text-xs font-semibold text-blue-700">
            {selectedQuiz.subject} · {selectedQuiz.questionCount} Butir Soal · Durasi {selectedQuiz.durationMinutes} Menit · Maks. Skor {selectedQuiz.totalMaxScore}
          </div>
          <h1 className="mt-2 font-display text-2xl font-bold text-slate-900">
            {selectedQuiz.title}
          </h1>

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Petunjuk Pengerjaan Ujian
            </h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">
              {selectedQuiz.instructions ||
                'Baca setiap teks dan media stimulus dengan saksama. Jawaban tersimpan otomatis. Pastikan mengumpulkan sebelum batas waktu berakhir.'}
            </p>
          </div>

          <div className="mt-5 rounded-xl border border-orange-200 bg-orange-50 p-5">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
              <div className="text-sm text-slate-800">
                <p className="font-semibold text-slate-900">Pengaturan Keamanan Sesi Aktif</p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-700">
                  <li>
                    {selectedQuiz.requireFullscreen
                      ? 'Wajib Fullscreen: keluar dari layar penuh akan dicatat sebagai pelanggaran.'
                      : 'Mode Fullscreen disarankan untuk fokus maksimal.'}
                  </li>
                  <li>
                    Seleksi teks soal, klik kanan, salin/tempel, dan pintasan DevTools diblokir selama ujian.
                  </li>
                  <li>
                    Perpindahan tab/jendela dan kehilangan fokus dicatat ke server.
                    {selectedQuiz.maxViolations > 0
                      ? ` Batas pelanggaran: ${selectedQuiz.maxViolations}x sebelum pengumpulan otomatis.`
                      : ''}
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {errorMsg && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800">
              {errorMsg}
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              Peserta: <strong className="text-slate-800">{studentName}</strong> ({nis} · {className})
            </p>
            <button
              type="button"
              onClick={() => void startQuizSession()}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-orange-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-orange-700 cursor-pointer"
            >
              <Maximize2 className="h-4 w-4" />
              <span>Masuk Layar Penuh & Mulai Ujian</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // STEP 4: MOBILE-FIRST SECURE EXAM RUNNER
  if (step === 'exam' && activeSession && currentQuestion) {
    const questions = activeSession.quiz.questions;
    const isFlagged = flagged.includes(currentQuestion.id);
    const timerDanger = secondsLeft <= 60;
    const timerWarning = secondsLeft > 60 && secondsLeft <= 300;
    const currentAnswer = answers[currentQuestion.id];

    const toggleFlag = () => {
      setFlagged((prev) =>
        prev.includes(currentQuestion.id)
          ? prev.filter((id) => id !== currentQuestion.id)
          : [...prev, currentQuestion.id]
      );
    };

    const hasMultimodal = Boolean(
      currentQuestion.stimulusText ||
        currentQuestion.stimulusImageUrl ||
        currentQuestion.stimulusAudioUrl
    );

    return (
      <div className="exam-lockdown min-h-screen bg-slate-100 pb-24 lg:pb-10">
        {/* Compact Sticky Exam Top Bar (<= 56px) */}
        <header className="sticky top-0 z-30 border-b border-slate-800 bg-[#0F2544] text-white">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold text-white">
                {activeSession.quiz.title}
              </p>
              <p className="truncate text-[11px] text-slate-300">
                {activeSession.studentName} · {activeSession.className} ·{' '}
                {autosaveStatus === 'saving'
                  ? 'Menyimpan...'
                  : autosaveStatus === 'offline'
                  ? 'Tersimpan lokal'
                  : 'Tersimpan otomatis'}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {violationCount > 0 && (
                <div className="hidden sm:flex items-center gap-1 rounded-lg bg-orange-600/20 border border-orange-400/40 px-2.5 py-1 text-xs font-semibold text-orange-200">
                  <ShieldAlert className="h-3.5 w-3.5 text-orange-400" />
                  <span className="font-mono tabular-nums">
                    Pelanggaran: {violationCount}
                    {activeSession.quiz.maxViolations > 0
                      ? `/${activeSession.quiz.maxViolations}`
                      : ''}
                  </span>
                </div>
              )}

              <div
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-sm font-bold tabular-nums ${
                  timerDanger
                    ? 'bg-red-600 text-white'
                    : timerWarning
                    ? 'bg-orange-500 text-white'
                    : 'bg-blue-600 text-white'
                }`}
              >
                <Clock className="h-3.5 w-3.5" />
                <span>{formatCountdown(secondsLeft)}</span>
              </div>

              <button
                type="button"
                onClick={() => setShowSubmitConfirm(true)}
                className="hidden lg:inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-orange-600 px-3.5 text-xs font-semibold text-white hover:bg-orange-700 cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Kumpulkan</span>
              </button>
            </div>
          </div>
        </header>

        {/* Fullscreen / Security Warning Banner */}
        {(security.warningMessage ||
          (activeSession.quiz.requireFullscreen && !security.isFullscreen)) && (
          <div className="mx-auto max-w-7xl px-4 pt-3">
            <div className="flex flex-col gap-2 rounded-xl border border-orange-300 bg-orange-50 p-3.5 text-xs text-orange-950 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
                <div>
                  <p className="font-semibold">
                    {security.warningMessage ||
                      'Mode layar penuh belum aktif. Aktifkan layar penuh untuk menjaga integritas ujian.'}
                  </p>
                  <p className="mt-0.5 text-orange-800">
                    Insiden tercatat: {violationCount}
                    {activeSession.quiz.maxViolations > 0
                      ? ` dari batas maksimal ${activeSession.quiz.maxViolations}.`
                      : '.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {activeSession.quiz.requireFullscreen && !security.isFullscreen && (
                  <button
                    type="button"
                    onClick={() => void security.requestFullscreen()}
                    className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 cursor-pointer"
                  >
                    Aktifkan Layar Penuh
                  </button>
                )}
                {security.warningMessage && (
                  <button
                    type="button"
                    onClick={security.clearWarning}
                    className="rounded-lg border border-orange-300 bg-white px-2.5 py-1.5 text-xs font-medium text-orange-900 hover:bg-orange-100 cursor-pointer"
                  >
                    Tutup
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Main Exam Grid */}
        <main className="mx-auto mt-4 grid max-w-7xl gap-5 px-4 lg:grid-cols-12">
          {/* Question & Multimodal Area */}
          <div className="lg:col-span-9 space-y-5">
            <div className={`grid gap-5 ${hasMultimodal ? 'lg:grid-cols-12' : ''}`}>
              {hasMultimodal && (
                <section className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                      Stimulus Multimodal
                    </span>
                    <span className="text-xs text-slate-400">
                      Soal #{currentIdx + 1}
                    </span>
                  </div>

                  {currentQuestion.stimulusImageUrl && (
                    <figure className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                      <img
                        src={currentQuestion.stimulusImageUrl}
                        alt={currentQuestion.stimulusCaption || 'Gambar stimulus ujian'}
                        referrerPolicy="no-referrer"
                        className="max-h-72 w-full object-contain bg-slate-900/5"
                      />
                      {currentQuestion.stimulusCaption && (
                        <figcaption className="border-t border-slate-200 px-3 py-2 text-xs text-slate-600">
                          {currentQuestion.stimulusCaption}
                        </figcaption>
                      )}
                    </figure>
                  )}

                  {currentQuestion.stimulusAudioUrl && (
                    <AudioStimulusPlayer
                      src={currentQuestion.stimulusAudioUrl}
                      playLimit={currentQuestion.audioPlayLimit}
                      questionId={currentQuestion.id}
                      attemptId={activeSession.attemptId}
                    />
                  )}

                  {currentQuestion.stimulusText && (
                    <div className="rounded-xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-800 whitespace-pre-line border border-slate-200/80">
                      {currentQuestion.stimulusText}
                    </div>
                  )}
                </section>
              )}

              <section
                className={`${
                  hasMultimodal ? 'lg:col-span-6' : 'col-span-12'
                } rounded-2xl border border-slate-200 bg-white p-5 sm:p-6`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="font-mono font-bold text-[#0F2544]">
                      Soal {currentIdx + 1} / {questions.length}
                    </span>
                    <span>·</span>
                    <span className="font-medium text-blue-700">
                      {QUESTION_TYPE_LABELS[currentQuestion.type]}
                    </span>
                    <span>·</span>
                    <span className="font-mono tabular-nums">
                      {currentQuestion.points} poin
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={toggleFlag}
                    className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors cursor-pointer ${
                      isFlagged
                        ? 'border-orange-500 bg-orange-50 text-orange-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Flag className="h-3.5 w-3.5" />
                    <span>{isFlagged ? 'Ditandai Ragu' : 'Tandai Ragu-ragu'}</span>
                  </button>
                </div>

                <h2 className="mt-4 font-display text-base sm:text-lg font-semibold leading-relaxed text-slate-900 whitespace-pre-line">
                  {currentQuestion.prompt}
                </h2>

                {/* Type 1: Pilihan Ganda */}
                {currentQuestion.type === 'mcq' && (
                  <div className="mt-5 space-y-2.5">
                    {(currentQuestion.options || []).map((opt) => {
                      const selected = currentAnswer === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            setAnswers((prev) => ({ ...prev, [currentQuestion.id]: opt.id }))
                          }
                          className={`flex min-h-[52px] w-full items-center gap-3.5 rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
                            selected
                              ? 'border-blue-600 bg-blue-50 text-slate-900'
                              : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <span
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold ${
                              selected
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {opt.label}
                          </span>
                          <span className="text-sm leading-snug">{opt.text}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Type 2: Pilihan Ganda Kompleks */}
                {currentQuestion.type === 'complex_mcq' && (
                  <div className="mt-5 space-y-2.5">
                    <p className="text-xs font-medium text-blue-700">
                      Pilih satu atau lebih jawaban yang tepat:
                    </p>
                    {(currentQuestion.options || []).map((opt) => {
                      const arr = Array.isArray(currentAnswer) ? currentAnswer : [];
                      const checked = arr.includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            const next = checked
                              ? arr.filter((id) => id !== opt.id)
                              : [...arr, opt.id];
                            setAnswers((prev) => ({ ...prev, [currentQuestion.id]: next }));
                          }}
                          className={`flex min-h-[52px] w-full items-center gap-3.5 rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
                            checked
                              ? 'border-blue-600 bg-blue-50 text-slate-900'
                              : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <span
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
                              checked
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-slate-300 bg-white'
                            }`}
                          >
                            {checked && <Check className="h-3.5 w-3.5" />}
                          </span>
                          <span className="font-mono text-xs font-bold text-slate-500">
                            {opt.label}.
                          </span>
                          <span className="text-sm leading-snug">{opt.text}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Type 3: Mengelompokkan (Grouping) */}
                {currentQuestion.type === 'grouping' && (
                  <div className="mt-5 space-y-4">
                    <p className="text-xs font-medium text-blue-700">
                      Ketuk kategori yang sesuai untuk setiap pernyataan di bawah ini:
                    </p>
                    {(currentQuestion.items || []).map((item, iIdx) => {
                      const mapVal =
                        currentAnswer &&
                        typeof currentAnswer === 'object' &&
                        !Array.isArray(currentAnswer)
                          ? (currentAnswer as Record<string, string>)
                          : {};
                      const chosenCat = mapVal[item.id] || '';
                      return (
                        <div
                          key={item.id}
                          className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                        >
                          <p className="text-sm font-medium text-slate-900">
                            <span className="font-mono text-xs text-slate-500 mr-2">
                              #{iIdx + 1}
                            </span>
                            {item.text}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {(currentQuestion.categories || []).map((cat) => {
                              const active = chosenCat === cat.id;
                              return (
                                <button
                                  key={cat.id}
                                  type="button"
                                  onClick={() => {
                                    setAnswers((prev) => ({
                                      ...prev,
                                      [currentQuestion.id]: {
                                        ...mapVal,
                                        [item.id]: cat.id,
                                      },
                                    }));
                                  }}
                                  className={`min-h-[40px] rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                                    active
                                      ? 'border-blue-600 bg-blue-600 text-white'
                                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                                  }`}
                                >
                                  {cat.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Type 4: Uraian Singkat */}
                {currentQuestion.type === 'short_essay' && (
                  <div className="mt-5">
                    <label className="block text-xs font-medium text-slate-600 mb-2">
                      Ketik jawaban singkat Anda:
                    </label>
                    <input
                      type="text"
                      value={typeof currentAnswer === 'string' ? currentAnswer : ''}
                      onChange={(e) =>
                        setAnswers((prev) => ({
                          ...prev,
                          [currentQuestion.id]: e.target.value,
                        }))
                      }
                      placeholder="Tulis jawaban singkat..."
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full min-h-[48px] rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                  </div>
                )}

                {/* Type 5: Uraian Panjang */}
                {currentQuestion.type === 'long_essay' && (
                  <div className="mt-5">
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                      <span>Ketik jawaban uraian lengkap Anda (dinilai oleh guru):</span>
                      <span className="font-mono tabular-nums">
                        {typeof currentAnswer === 'string' && currentAnswer.trim()
                          ? `${currentAnswer.trim().split(/\s+/).length} kata`
                          : '0 kata'}
                      </span>
                    </div>
                    <textarea
                      rows={7}
                      value={typeof currentAnswer === 'string' ? currentAnswer : ''}
                      onChange={(e) =>
                        setAnswers((prev) => ({
                          ...prev,
                          [currentQuestion.id]: e.target.value,
                        }))
                      }
                      placeholder="Tuliskan analisis, argumen, atau jawaban lengkap Anda di sini..."
                      spellCheck={false}
                      className="w-full rounded-xl border border-slate-300 bg-white p-4 text-sm leading-relaxed text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                  </div>
                )}

                {/* Desktop Prev / Next controls */}
                <div className="mt-6 hidden lg:flex items-center justify-between border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    disabled={currentIdx === 0}
                    onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span>Sebelumnya</span>
                  </button>

                  {currentIdx < questions.length - 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setCurrentIdx((i) => Math.min(questions.length - 1, i + 1))
                      }
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 cursor-pointer"
                    >
                      <span>Soal Berikutnya</span>
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowSubmitConfirm(true)}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-orange-600 px-5 text-sm font-semibold text-white hover:bg-orange-700 cursor-pointer"
                    >
                      <Send className="h-4 w-4" />
                      <span>Selesai & Kumpulkan</span>
                    </button>
                  )}
                </div>
              </section>
            </div>
          </div>

          {/* Desktop Question Navigator Rail */}
          <aside className="hidden lg:block lg:col-span-3">
            <div className="sticky top-20 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-slate-900">
                  Navigasi Soal
                </h3>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {answeredCount}/{questions.length} terjawab
                </span>
              </div>

              <div className="mt-4 grid grid-cols-5 gap-2">
                {questions.map((q, idx) => {
                  const answered = isQuestionAnswered(q, answers[q.id]);
                  const isFl = flagged.includes(q.id);
                  const active = idx === currentIdx;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setCurrentIdx(idx)}
                      className={`relative flex h-10 items-center justify-center rounded-lg border font-mono text-xs font-bold transition-colors cursor-pointer ${
                        active
                          ? 'border-[#0F2544] bg-[#0F2544] text-white ring-2 ring-blue-500/40'
                          : isFl
                          ? 'border-orange-500 bg-orange-50 text-orange-800'
                          : answered
                          ? 'border-blue-600 bg-blue-50 text-blue-800'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {idx + 1}
                      {isFl && (
                        <span
                          aria-label="Ragu-ragu"
                          className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-orange-500"
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600">
                <p className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded border border-blue-600 bg-blue-50" />
                  <span>Sudah Dijawab</span>
                </p>
                <p className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded border border-orange-500 bg-orange-50" />
                  <span>Ditandai Ragu-ragu</span>
                </p>
                <p className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded border border-slate-200 bg-white" />
                  <span>Belum Dijawab</span>
                </p>
              </div>
            </div>
          </aside>
        </main>

        {/* Mobile Bottom Thumb-Zone Control Bar (<= 15% viewport height) */}
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur-md lg:hidden">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-2">
            <button
              type="button"
              disabled={currentIdx === 0}
              onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-40 cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => setShowNavDrawer(true)}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-800 cursor-pointer"
            >
              <Grid className="h-4 w-4 text-blue-600" />
              <span className="font-mono tabular-nums">
                {currentIdx + 1}/{questions.length} ({answeredCount} isi)
              </span>
            </button>

            {currentIdx < questions.length - 1 ? (
              <button
                type="button"
                onClick={() =>
                  setCurrentIdx((i) => Math.min(questions.length - 1, i + 1))
                }
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white cursor-pointer"
              >
                <span>Lanjut</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowSubmitConfirm(true)}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-orange-600 px-4 text-xs font-semibold text-white cursor-pointer"
              >
                <Send className="h-4 w-4" />
                <span>Kumpul</span>
              </button>
            )}
          </div>
        </div>

        {/* Mobile Question Navigator Bottom Sheet */}
        {showNavDrawer && (
          <div className="fixed inset-0 z-50 flex items-end bg-slate-950/60 backdrop-blur-xs lg:hidden">
            <div className="w-full rounded-t-3xl bg-white p-5 pb-8 max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h3 className="font-display text-base font-bold text-slate-900">
                  Daftar Soal ({answeredCount}/{questions.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setShowNavDrawer(false)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 grid grid-cols-5 gap-2.5">
                {questions.map((q, idx) => {
                  const answered = isQuestionAnswered(q, answers[q.id]);
                  const isFl = flagged.includes(q.id);
                  const active = idx === currentIdx;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => {
                        setCurrentIdx(idx);
                        setShowNavDrawer(false);
                      }}
                      className={`min-h-[44px] rounded-xl border font-mono text-xs font-bold cursor-pointer ${
                        active
                          ? 'border-[#0F2544] bg-[#0F2544] text-white'
                          : isFl
                          ? 'border-orange-500 bg-orange-50 text-orange-800'
                          : answered
                          ? 'border-blue-600 bg-blue-50 text-blue-800'
                          : 'border-slate-200 bg-white text-slate-600'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowNavDrawer(false);
                  setShowSubmitConfirm(true);
                }}
                className="mt-5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-semibold text-white cursor-pointer"
              >
                <Send className="h-4 w-4" />
                <span>Kumpulkan Ujian Sekarang</span>
              </button>
            </div>
          </div>
        )}

        {/* Final Submit Confirmation Modal */}
        {showSubmitConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <h3 className="font-display text-lg font-bold text-slate-900">
                Konfirmasi Pengumpulan Ujian
              </h3>
              <p className="mt-2 text-sm text-slate-600">
                Anda telah menjawab{' '}
                <strong className="text-slate-900">
                  {answeredCount} dari {questions.length}
                </strong>{' '}
                soal
                {flagged.length > 0
                  ? ` (${flagged.length} soal masih ditandai ragu-ragu)`
                  : ''}
                . Setelah dikumpulkan, jawaban tidak dapat diubah lagi.
              </p>

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setShowSubmitConfirm(false)}
                  className="min-h-[44px] rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Periksa Lagi
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleFinalSubmit(false)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-orange-600 px-5 text-sm font-semibold text-white hover:bg-orange-700 cursor-pointer disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                  <span>{submitting ? 'Mengirim...' : 'Ya, Kumpulkan'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // STEP 5: SUBMITTED RECEIPT
  if (step === 'submitted' && submittedResult) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xs">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h1 className="mt-4 font-display text-2xl font-bold text-slate-900">
            Ujian Berhasil Dikumpulkan
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            {submittedResult.autoSubmitted
              ? 'Dikumpulkan otomatis oleh sistem berdasarkan batas waktu/pengawasan.'
              : 'Jawaban telah divalidasi dan disegel oleh server.'}
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs text-slate-500">Skor Soal Objektif (Otomatis)</p>
              <p className="mt-1 font-mono text-2xl font-bold text-[#0F2544] tabular-nums">
                {submittedResult.objectiveScore} / {submittedResult.maxObjectiveScore}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs text-slate-500">Bobot Uraian Panjang (Menunggu Guru)</p>
              <p className="mt-1 font-mono text-2xl font-bold text-blue-700 tabular-nums">
                {submittedResult.maxManualScore} poin
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 space-y-1">
            <p>
              Peserta: <strong className="text-slate-900">{studentName}</strong> ({nis} · {className})
            </p>
            <p>
              Waktu Selesai:{' '}
              <span className="font-mono">
                {new Date(submittedResult.submittedAt).toLocaleString('id-ID')}
              </span>
            </p>
            <p className="truncate">
              Tanda Terima Server (HMAC):{' '}
              <span className="font-mono text-slate-800">{submittedResult.serverReceipt}</span>
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setSubmittedResult(null);
              setStep('catalog');
              void loadQuizzesForClass();
            }}
            className="mt-6 inline-flex min-h-[46px] w-full items-center justify-center rounded-xl bg-[#0F2544] px-5 text-sm font-semibold text-white hover:bg-blue-700 cursor-pointer"
          >
            Kembali ke Daftar Kuis Kelas
          </button>
        </div>
      </div>
    );
  }

  return null;
};
