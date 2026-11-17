import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  AlertTriangle,
  BarChart3,
  BookMarked,
  CheckCircle2,
  ClipboardCheck,
  Cloud,
  CloudOff,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  FileUp,
  Layers,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  googleAuthProvider,
} from '../lib/firebase.ts';
import {
  deleteAttemptAdmin,
  deleteParticipantAdmin,
  deleteQuestionBankItem,
  deleteQuizAdmin,
  ensureAdminProfile,
  getQuizKeysAdmin,
  listAllQuizzesAdmin,
  listAttemptsAdmin,
  listParticipantsAdmin,
  listQuestionBankAdmin,
  mergePublicAndKeys,
  saveManualEssayGradeAdmin,
  saveParticipantAdmin,
  saveQuestionBankItem,
  saveQuizWithSealedKeys,
  seedMultimodalEnglishPack,
} from '../lib/firestoreApi.ts';
import {
  exportResultsToCsv,
  exportResultsToExcel,
  exportResultsToPdf,
} from '../lib/exportReports.ts';
import type {
  FullQuestion,
  ParsedImportQuestion,
  ParticipantRecord,
  QuestionBankItem,
  QuestionType,
  QuizAttempt,
  QuizDocument,
  QuizStatus,
} from '../types/quiz.ts';
import { AdminQuestionEditor } from './AdminQuestionEditor.tsx';

type AdminTab =
  | 'quizzes'
  | 'bank'
  | 'import'
  | 'participants'
  | 'grading'
  | 'analytics';

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function toLocalDatetimeInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function createBlankQuestion(num: number): FullQuestion {
  return {
    id: uid('q'),
    number: num,
    type: 'mcq',
    prompt: '',
    points: 10,
    options: [
      { id: 'opt_A', label: 'A', text: '' },
      { id: 'opt_B', label: 'B', text: '' },
      { id: 'opt_C', label: 'C', text: '' },
      { id: 'opt_D', label: 'D', text: '' },
    ],
    correctOptionId: 'opt_A',
  };
}

export const AdminPortal: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAdminAuthorized, setIsAdminAuthorized] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<AdminTab>('quizzes');
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Core data collections
  const [quizzes, setQuizzes] = useState<QuizDocument[]>([]);
  const [bankItems, setBankItems] = useState<QuestionBankItem[]>([]);
  const [participants, setParticipants] = useState<ParticipantRecord[]>([]);
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [receiptValidity, setReceiptValidity] = useState<Record<string, boolean>>({});
  const [loadingData, setLoadingData] = useState(false);

  // Quiz Editor State
  const [editingQuizId, setEditingQuizId] = useState<string | null>(null);
  const [isNewQuiz, setIsNewQuiz] = useState(true);
  const [qTitle, setQTitle] = useState('');
  const [qSubject, setQSubject] = useState('Bahasa Inggris');
  const [qDesc, setQDesc] = useState('');
  const [qInstructions, setQInstructions] = useState('');
  const [qClassTargets, setQClassTargets] = useState('X TJKT 1, X TJKT 2');
  const [qStatus, setQStatus] = useState<QuizStatus>('published');
  const [qStartAt, setQStartAt] = useState(() =>
    toLocalDatetimeInput(new Date(Date.now() - 3600_000).toISOString())
  );
  const [qEndAt, setQEndAt] = useState(() =>
    toLocalDatetimeInput(new Date(Date.now() + 7 * 24 * 3600_000).toISOString())
  );
  const [qDuration, setQDuration] = useState(45);
  const [qShuffle, setQShuffle] = useState(false);
  const [qFullscreen, setQFullscreen] = useState(true);
  const [qMaxViolations, setQMaxViolations] = useState(5);
  const [qQuestions, setQQuestions] = useState<FullQuestion[]>([]);
  const [savingQuiz, setSavingQuiz] = useState(false);
  const [showBankPicker, setShowBankPicker] = useState(false);
  const [cloudSyncState, setCloudSyncState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [unsyncedLocalDraft, setUnsyncedLocalDraft] = useState<{
    quizId: string;
    title: string;
    subject: string;
    description: string;
    instructions: string;
    classTargets: string[];
    status: QuizStatus;
    startAt: string;
    endAt: string;
    durationMinutes: number;
    shuffleQuestions: boolean;
    requireFullscreen: boolean;
    maxViolations: number;
    fullQuestions: FullQuestion[];
    savedAt: string;
  } | null>(null);
  const editorReadyForAutosaveRef = useRef(false);
  const autosaveInFlightRef = useRef(false);
  const lastSavedSignatureRef = useRef('');
  const isNewQuizRef = useRef(true);

  // Bank Filter State
  const [bankSearch, setBankSearch] = useState('');
  const [bankTypeFilter, setBankTypeFilter] = useState<string>('all');

  // Importer State
  const [importingFile, setImportingFile] = useState(false);
  const [parsedImports, setParsedImports] = useState<ParsedImportQuestion[]>([]);
  const [importFilename, setImportFilename] = useState('');
  const [importTargetQuizId, setImportTargetQuizId] = useState<string>('NEW_DRAFT');

  // Participant State
  const [pNis, setPNis] = useState('');
  const [pName, setPName] = useState('');
  const [pClass, setPClass] = useState('');
  const [bulkRosterText, setBulkRosterText] = useState('');
  const [participantSearch, setParticipantSearch] = useState('');

  // Grading & Analytics Quiz Filter
  const [selectedQuizFilter, setSelectedQuizFilter] = useState<string>('ALL');
  const [gradingAttempt, setGradingAttempt] = useState<QuizAttempt | null>(null);
  const [manualScoresDraft, setManualScoresDraft] = useState<Record<string, number>>({});
  const [manualFeedbackDraft, setManualFeedbackDraft] = useState<Record<string, string>>({});
  const [savingGrade, setSavingGrade] = useState(false);

  const showMessage = (type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 4500);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthError(null);
      if (u) {
        try {
          const ok = await ensureAdminProfile();
          setIsAdminAuthorized(ok);
          if (!ok) {
            setAuthError(
              `Akun ${u.email} belum terdaftar sebagai admin. Hubungi Super Admin (${BOOTSTRAPPED_ADMIN_EMAIL}).`
            );
          }
        } catch (err) {
          setIsAdminAuthorized(false);
          setAuthError(err instanceof Error ? err.message : 'Gagal memverifikasi hak akses admin.');
        }
      } else {
        setIsAdminAuthorized(false);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const refreshAllAdminData = useCallback(async () => {
    if (!isAdminAuthorized) return;
    setLoadingData(true);
    try {
      const [qz, bk, pts, atts] = await Promise.all([
        listAllQuizzesAdmin(),
        listQuestionBankAdmin(),
        listParticipantsAdmin(),
        listAttemptsAdmin(),
      ]);
      setQuizzes(qz);
      setBankItems(bk);
      setParticipants(pts);
      setAttempts(atts);

      if (atts.length > 0 && auth.currentUser) {
        const token = await auth.currentUser.getIdToken();
        const verRes = await fetch('/api/admin/verify-receipts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            attempts: atts
              .filter((a) => a.status !== 'in_progress')
              .map((a) => ({
                id: a.id,
                quizId: a.quizId,
                nis: a.nis,
                className: a.className,
                startedAt: a.startedAt,
                submittedAt: a.submittedAt,
                objectiveScore: a.objectiveScore,
                maxObjectiveScore: a.maxObjectiveScore,
                maxScore: a.maxScore,
                sessionNonce: a.sessionNonce,
                serverReceipt: a.serverReceipt,
              })),
          }),
        });
        if (verRes.ok) {
          const { results } = (await verRes.json()) as { results: Record<string, boolean> };
          setReceiptValidity(results);
        }
      }
    } catch (err) {
      showMessage('err', err instanceof Error ? err.message : 'Gagal memuat data admin.');
    } finally {
      setLoadingData(false);
    }
  }, [isAdminAuthorized]);

  useEffect(() => {
    if (isAdminAuthorized) {
      void refreshAllAdminData();
    }
  }, [isAdminAuthorized, refreshAllAdminData]);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/unauthorized-domain') {
        setAuthError(
          `Domain "${window.location.hostname}" belum diizinkan di Firebase Authentication. Tambahkan domain ini di Firebase Console → Authentication → Settings → Authorized domains.`
        );
        return;
      }
      setAuthError(err instanceof Error ? err.message : 'Login Google dibatalkan atau gagal.');
    }
  };

  const checkUnsyncedLocalDraft = useCallback(() => {
    try {
      const raw = localStorage.getItem('sq_admin_quiz_draft_v1');
      if (!raw) {
        setUnsyncedLocalDraft(null);
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed && parsed.syncedToCloud === false && Array.isArray(parsed.fullQuestions)) {
        setUnsyncedLocalDraft(parsed);
      } else {
        setUnsyncedLocalDraft(null);
      }
    } catch {
      setUnsyncedLocalDraft(null);
    }
  }, []);

  useEffect(() => {
    if (isAdminAuthorized && !editingQuizId) {
      checkUnsyncedLocalDraft();
    }
  }, [isAdminAuthorized, editingQuizId, checkUnsyncedLocalDraft]);

  const openNewQuizEditor = () => {
    editorReadyForAutosaveRef.current = false;
    lastSavedSignatureRef.current = '';
    isNewQuizRef.current = true;
    setEditingQuizId(uid('quiz'));
    setIsNewQuiz(true);
    setQTitle('');
    setQSubject('Bahasa Inggris');
    setQDesc('');
    setQInstructions(
      '1. Kerjakan dengan jujur dalam mode layar penuh.\n2. Periksa setiap stimulus teks, gambar, atau audio sebelum menjawab.'
    );
    setQClassTargets('X TJKT 1, X TJKT 2');
    setQStatus('draft');
    setQStartAt(toLocalDatetimeInput(new Date(Date.now() - 1800_000).toISOString()));
    setQEndAt(toLocalDatetimeInput(new Date(Date.now() + 7 * 24 * 3600_000).toISOString()));
    setQDuration(45);
    setQShuffle(false);
    setQFullscreen(true);
    setQMaxViolations(5);
    setQQuestions([createBlankQuestion(1)]);
    setCloudSyncState('idle');
    setLastSyncedAt(null);
    window.setTimeout(() => {
      editorReadyForAutosaveRef.current = true;
    }, 150);
  };

  const openExistingQuizEditor = async (quiz: QuizDocument) => {
    editorReadyForAutosaveRef.current = false;
    try {
      const keys = await getQuizKeysAdmin(quiz.id);
      const merged = mergePublicAndKeys(quiz.questions, keys);
      const startLocal = toLocalDatetimeInput(quiz.startAt);
      const endLocal = toLocalDatetimeInput(quiz.endAt);
      const classJoined = (quiz.classTargets || []).join(', ');
      isNewQuizRef.current = false;
      setEditingQuizId(quiz.id);
      setIsNewQuiz(false);
      setQTitle(quiz.title);
      setQSubject(quiz.subject);
      setQDesc(quiz.description || '');
      setQInstructions(quiz.instructions || '');
      setQClassTargets(classJoined);
      setQStatus(quiz.status);
      setQStartAt(startLocal);
      setQEndAt(endLocal);
      setQDuration(quiz.durationMinutes);
      setQShuffle(quiz.shuffleQuestions);
      setQFullscreen(quiz.requireFullscreen);
      setQMaxViolations(quiz.maxViolations);
      setQQuestions(merged);
      lastSavedSignatureRef.current = JSON.stringify({
        quizId: quiz.id,
        title: quiz.title.trim() || 'Draf Kuis Tanpa Judul',
        subject: quiz.subject.trim() || 'Umum',
        description: quiz.description || '',
        instructions: quiz.instructions || '',
        classTargets: classJoined.split(',').map((s) => s.trim()).filter(Boolean),
        status: quiz.status,
        startAt: startLocal ? new Date(startLocal).toISOString() : quiz.startAt,
        endAt: endLocal ? new Date(endLocal).toISOString() : quiz.endAt,
        durationMinutes: quiz.durationMinutes,
        shuffleQuestions: quiz.shuffleQuestions,
        requireFullscreen: quiz.requireFullscreen,
        maxViolations: quiz.maxViolations,
        fullQuestions: merged,
      });
      setCloudSyncState('saved');
      setLastSyncedAt(new Date().toLocaleTimeString('id-ID'));
      window.setTimeout(() => {
        editorReadyForAutosaveRef.current = true;
      }, 150);
    } catch (err) {
      showMessage('err', err instanceof Error ? err.message : 'Gagal membuka editor kuis.');
    }
  };

  const restoreUnsyncedLocalDraft = () => {
    if (!unsyncedLocalDraft) return;
    editorReadyForAutosaveRef.current = false;
    lastSavedSignatureRef.current = '';
    const existsInCloud = quizzes.some((q) => q.id === unsyncedLocalDraft.quizId);
    isNewQuizRef.current = !existsInCloud;
    setEditingQuizId(unsyncedLocalDraft.quizId);
    setIsNewQuiz(!existsInCloud);
    setQTitle(unsyncedLocalDraft.title === 'Draf Kuis Tanpa Judul' ? '' : unsyncedLocalDraft.title);
    setQSubject(unsyncedLocalDraft.subject);
    setQDesc(unsyncedLocalDraft.description || '');
    setQInstructions(unsyncedLocalDraft.instructions || '');
    setQClassTargets((unsyncedLocalDraft.classTargets || []).join(', '));
    setQStatus(unsyncedLocalDraft.status || 'draft');
    setQStartAt(toLocalDatetimeInput(unsyncedLocalDraft.startAt));
    setQEndAt(toLocalDatetimeInput(unsyncedLocalDraft.endAt));
    setQDuration(unsyncedLocalDraft.durationMinutes || 45);
    setQShuffle(Boolean(unsyncedLocalDraft.shuffleQuestions));
    setQFullscreen(unsyncedLocalDraft.requireFullscreen !== false);
    setQMaxViolations(unsyncedLocalDraft.maxViolations ?? 5);
    setQQuestions(unsyncedLocalDraft.fullQuestions);
    setUnsyncedLocalDraft(null);
    setCloudSyncState('saving');
    window.setTimeout(() => {
      editorReadyForAutosaveRef.current = true;
    }, 150);
  };

  // Real-time online Cloud Autosave (debounced 2s to Firestore + localStorage backup)
  useEffect(() => {
    if (!editingQuizId || !isAdminAuthorized || !editorReadyForAutosaveRef.current) return;
    if (qQuestions.length === 0 || savingQuiz) return;

    const draftPayload = {
      quizId: editingQuizId,
      title: qTitle.trim() || 'Draf Kuis Tanpa Judul',
      subject: qSubject.trim() || 'Umum',
      description: qDesc,
      instructions: qInstructions,
      classTargets: qClassTargets
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      status: qStatus,
      startAt: qStartAt ? new Date(qStartAt).toISOString() : new Date().toISOString(),
      endAt: qEndAt
        ? new Date(qEndAt).toISOString()
        : new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
      durationMinutes: qDuration,
      shuffleQuestions: qShuffle,
      requireFullscreen: qFullscreen,
      maxViolations: qMaxViolations,
      fullQuestions: qQuestions,
    };

    const signature = JSON.stringify(draftPayload);
    if (signature === lastSavedSignatureRef.current) {
      return;
    }

    try {
      localStorage.setItem(
        'sq_admin_quiz_draft_v1',
        JSON.stringify({ ...draftPayload, syncedToCloud: false, savedAt: new Date().toISOString() })
      );
    } catch {
      // ignore storage quota
    }

    setCloudSyncState('saving');
    const timer = window.setTimeout(async () => {
      if (autosaveInFlightRef.current) return;
      autosaveInFlightRef.current = true;
      try {
        await saveQuizWithSealedKeys({
          ...draftPayload,
          classTargets: draftPayload.classTargets.length > 0 ? draftPayload.classTargets : ['SEMUA'],
          isNew: isNewQuizRef.current,
        });
        isNewQuizRef.current = false;
        setIsNewQuiz(false);
        lastSavedSignatureRef.current = signature;
        setCloudSyncState('saved');
        setLastSyncedAt(new Date().toLocaleTimeString('id-ID'));
        try {
          localStorage.setItem(
            'sq_admin_quiz_draft_v1',
            JSON.stringify({ ...draftPayload, syncedToCloud: true, savedAt: new Date().toISOString() })
          );
        } catch {
          // ignore
        }
      } catch {
        setCloudSyncState('error');
      } finally {
        autosaveInFlightRef.current = false;
      }
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [
    editingQuizId,
    isAdminAuthorized,
    qClassTargets,
    qDesc,
    qDuration,
    qEndAt,
    qFullscreen,
    qInstructions,
    qMaxViolations,
    qQuestions,
    qShuffle,
    qStartAt,
    qStatus,
    qSubject,
    qTitle,
    savingQuiz,
  ]);

  const closeQuizEditorWithFlush = async () => {
    editorReadyForAutosaveRef.current = false;
    if (editingQuizId && qQuestions.length > 0) {
      const targets = qClassTargets.split(',').map((s) => s.trim()).filter(Boolean);
      const draftPayload = {
        quizId: editingQuizId,
        title: qTitle.trim() || 'Draf Kuis Tanpa Judul',
        subject: qSubject.trim() || 'Umum',
        description: qDesc,
        instructions: qInstructions,
        classTargets: targets,
        status: qStatus,
        startAt: qStartAt ? new Date(qStartAt).toISOString() : new Date().toISOString(),
        endAt: qEndAt
          ? new Date(qEndAt).toISOString()
          : new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
        durationMinutes: qDuration,
        shuffleQuestions: qShuffle,
        requireFullscreen: qFullscreen,
        maxViolations: qMaxViolations,
        fullQuestions: qQuestions,
      };
      const signature = JSON.stringify(draftPayload);
      if (signature !== lastSavedSignatureRef.current && (qTitle.trim() || qQuestions.some((q) => q.prompt.trim()))) {
        try {
          await saveQuizWithSealedKeys({
            ...draftPayload,
            classTargets: targets.length > 0 ? targets : ['SEMUA'],
            isNew: isNewQuizRef.current,
          });
          localStorage.removeItem('sq_admin_quiz_draft_v1');
        } catch {
          // Keep unsynced local draft for recovery
        }
      } else {
        localStorage.removeItem('sq_admin_quiz_draft_v1');
      }
    }
    setEditingQuizId(null);
    await refreshAllAdminData();
  };

  const handleSaveQuiz = async (e: React.FormEvent, overrideStatus?: QuizStatus) => {
    e.preventDefault();
    if (!editingQuizId) return;
    if (!qTitle.trim() || qQuestions.length === 0) {
      showMessage('err', 'Judul kuis dan minimal 1 soal wajib diisi.');
      return;
    }

    const finalStatus = overrideStatus ?? qStatus;
    setSavingQuiz(true);
    try {
      const targets = qClassTargets
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await saveQuizWithSealedKeys({
        quizId: editingQuizId,
        title: qTitle,
        subject: qSubject,
        description: qDesc,
        instructions: qInstructions,
        classTargets: targets.length > 0 ? targets : ['SEMUA'],
        status: finalStatus,
        startAt: new Date(qStartAt).toISOString(),
        endAt: new Date(qEndAt).toISOString(),
        durationMinutes: qDuration,
        shuffleQuestions: qShuffle,
        requireFullscreen: qFullscreen,
        maxViolations: qMaxViolations,
        fullQuestions: qQuestions,
        isNew: isNewQuizRef.current,
      });
      showMessage(
        'ok',
        finalStatus === 'published'
          ? 'Kuis berhasil diterbitkan & kunci jawaban disegel AES-256-GCM.'
          : 'Kuis berhasil disimpan sebagai draf di Cloud Firestore.'
      );
      localStorage.removeItem('sq_admin_quiz_draft_v1');
      editorReadyForAutosaveRef.current = false;
      setEditingQuizId(null);
      await refreshAllAdminData();
    } catch (err) {
      showMessage('err', err instanceof Error ? err.message : 'Gagal menyimpan kuis.');
    } finally {
      setSavingQuiz(false);
    }
  };

  const handleQuickTogglePublish = async (quiz: QuizDocument) => {
    try {
      const keys = await getQuizKeysAdmin(quiz.id);
      const merged = mergePublicAndKeys(quiz.questions, keys);
      const nextStatus: QuizStatus = quiz.status === 'published' ? 'draft' : 'published';
      await saveQuizWithSealedKeys({
        quizId: quiz.id,
        title: quiz.title,
        subject: quiz.subject,
        description: quiz.description || '',
        instructions: quiz.instructions || '',
        classTargets: quiz.classTargets,
        status: nextStatus,
        startAt: quiz.startAt,
        endAt: quiz.endAt,
        durationMinutes: quiz.durationMinutes,
        shuffleQuestions: quiz.shuffleQuestions,
        requireFullscreen: quiz.requireFullscreen,
        maxViolations: quiz.maxViolations,
        fullQuestions: merged,
        isNew: false,
      });
      showMessage(
        'ok',
        nextStatus === 'published'
          ? `Kuis "${quiz.title}" diterbitkan untuk murid.`
          : `Kuis "${quiz.title}" dikembalikan ke draf.`
      );
      await refreshAllAdminData();
    } catch (err) {
      showMessage('err', err instanceof Error ? err.message : 'Gagal mengubah status kuis.');
    }
  };

  const handleSeedEnglishPack = async () => {
    try {
      await seedMultimodalEnglishPack();
      showMessage('ok', 'Paket Kuis Bahasa Inggris Multimodal & sampel peserta berhasil dibuat.');
      await refreshAllAdminData();
    } catch (err) {
      showMessage('err', err instanceof Error ? err.message : 'Gagal membuat paket contoh.');
    }
  };

  const handleUploadImportDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !auth.currentUser) return;
    setImportingFile(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch('/api/import/parse', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Gagal memproses file.');
      setImportFilename(data.filename);
      setParsedImports(data.questions || []);
      showMessage(
        'ok',
        `Berhasil mengekstrak ${(data.questions || []).length} butir soal dari ${data.filename}. Silakan verifikasi sebelum menyimpan.`
      );
    } catch (err) {
      showMessage('err', err instanceof Error ? err.message : 'Gagal mengimpor dokumen.');
    } finally {
      setImportingFile(false);
    }
  };

  const commitImportedQuestions = async (destination: 'quiz' | 'bank') => {
    if (parsedImports.length === 0) return;

    const converted: FullQuestion[] = parsedImports.map((imp, idx) => ({
      id: uid('q'),
      number: idx + 1,
      type: imp.type,
      prompt: imp.prompt,
      stimulusText: imp.stimulusText || undefined,
      stimulusImageUrl: imp.stimulusImageUrl || undefined,
      stimulusAudioUrl: imp.stimulusAudioUrl || undefined,
      stimulusCaption: imp.stimulusCaption || undefined,
      options: imp.options.length > 0 ? imp.options : undefined,
      categories: imp.categories.length > 0 ? imp.categories : undefined,
      items: imp.items.length > 0 ? imp.items : undefined,
      points: imp.points,
      correctOptionId: imp.correctOptionId || undefined,
      correctOptionIds: imp.correctOptionIds.length > 0 ? imp.correctOptionIds : undefined,
      correctMapping: Object.keys(imp.correctMapping).length > 0 ? imp.correctMapping : undefined,
      acceptedAnswers: imp.acceptedAnswers.length > 0 ? imp.acceptedAnswers : undefined,
      rubricNotes: imp.rubricNotes || undefined,
    }));

    try {
      if (destination === 'bank') {
        for (const fq of converted) {
          await saveQuestionBankItem({
            id: uid('bank'),
            subject: 'Bahasa Inggris',
            tags: ['impor', importFilename.slice(0, 25)],
            questionData: fq,
            isNew: true,
          });
        }
        showMessage('ok', `${converted.length} soal berhasil dimasukkan ke Bank Soal.`);
        setParsedImports([]);
        await refreshAllAdminData();
        setActiveTab('bank');
        return;
      }

      if (importTargetQuizId === 'NEW_DRAFT') {
        editorReadyForAutosaveRef.current = false;
        lastSavedSignatureRef.current = '';
        isNewQuizRef.current = true;
        setEditingQuizId(uid('quiz'));
        setIsNewQuiz(true);
        setQTitle(`Kuis Impor — ${importFilename.replace(/\.(docx|pdf)$/i, '')}`);
        setQSubject('Bahasa Inggris');
        setQDesc('Kuis hasil impor dokumen dengan verifikasi manual.');
        setQInstructions('Baca stimulus dan pertanyaan dengan cermat sebelum memilih jawaban.');
        setQClassTargets('X TJKT 1');
        setQStatus('draft');
        setQStartAt(toLocalDatetimeInput(new Date().toISOString()));
        setQEndAt(toLocalDatetimeInput(new Date(Date.now() + 7 * 24 * 3600_000).toISOString()));
        setQDuration(45);
        setQShuffle(false);
        setQFullscreen(true);
        setQMaxViolations(5);
        setQQuestions(converted);
        setParsedImports([]);
        setCloudSyncState('saving');
        setActiveTab('quizzes');
        window.setTimeout(() => {
          editorReadyForAutosaveRef.current = true;
        }, 150);
      } else {
        const target = quizzes.find((q) => q.id === importTargetQuizId);
        if (!target) return;
        const keys = await getQuizKeysAdmin(target.id);
        const existingFull = mergePublicAndKeys(target.questions, keys);
        const combined = [...existingFull, ...converted].map((q, idx) => ({
          ...q,
          number: idx + 1,
        }));
        await saveQuizWithSealedKeys({
          quizId: target.id,
          title: target.title,
          subject: target.subject,
          description: target.description || '',
          instructions: target.instructions || '',
          classTargets: target.classTargets,
          status: target.status,
          startAt: target.startAt,
          endAt: target.endAt,
          durationMinutes: target.durationMinutes,
          shuffleQuestions: target.shuffleQuestions,
          requireFullscreen: target.requireFullscreen,
          maxViolations: target.maxViolations,
          fullQuestions: combined,
          isNew: false,
        });
        showMessage('ok', `${converted.length} soal ditambahkan ke "${target.title}".`);
        setParsedImports([]);
        await refreshAllAdminData();
        setActiveTab('quizzes');
      }
    } catch (err) {
      showMessage('err', err instanceof Error ? err.message : 'Gagal menyimpan hasil impor.');
    }
  };

  const handleAddParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pNis.trim() || !pName.trim() || !pClass.trim()) return;
    try {
      await saveParticipantAdmin({
        id: `part_${pNis.trim().replace(/[^a-zA-Z0-9_-]/g, '')}`,
        nis: pNis,
        name: pName,
        className: pClass,
        active: true,
        isNew: false,
      });
      setPNis('');
      setPName('');
      setPClass('');
      showMessage('ok', 'Data peserta disimpan.');
      await refreshAllAdminData();
    } catch (err) {
      showMessage('err', err instanceof Error ? err.message : 'Gagal menyimpan peserta.');
    }
  };

  const handleBulkRosterImport = async () => {
    const lines = bulkRosterText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    let count = 0;
    try {
      for (const line of lines) {
        const parts = line.split(/[,\t;]+/).map((s) => s.trim());
        if (parts.length < 3) continue;
        const [nisVal, nameVal, classVal] = parts;
        if (!nisVal || !nameVal || !classVal) continue;
        await saveParticipantAdmin({
          id: `part_${nisVal.replace(/[^a-zA-Z0-9_-]/g, '')}`,
          nis: nisVal,
          name: nameVal,
          className: classVal,
          active: true,
          isNew: false,
        });
        count++;
      }
      setBulkRosterText('');
      showMessage('ok', `${count} peserta berhasil diimpor.`);
      await refreshAllAdminData();
    } catch (err) {
      showMessage('err', err instanceof Error ? err.message : 'Gagal mengimpor daftar peserta.');
    }
  };

  const filteredAttempts = useMemo(() => {
    if (selectedQuizFilter === 'ALL') return attempts;
    return attempts.filter((a) => a.quizId === selectedQuizFilter);
  }, [attempts, selectedQuizFilter]);

  const activeAnalyticsQuiz = useMemo(() => {
    if (selectedQuizFilter !== 'ALL') {
      return quizzes.find((q) => q.id === selectedQuizFilter) || quizzes[0] || null;
    }
    return quizzes[0] || null;
  }, [quizzes, selectedQuizFilter]);

  const analyticsAttempts = useMemo(() => {
    if (!activeAnalyticsQuiz) return [];
    return attempts.filter((a) => a.quizId === activeAnalyticsQuiz.id);
  }, [activeAnalyticsQuiz, attempts]);

  // AUTH GATE
  if (!authReady) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-slate-600">
        Memeriksa sesi admin...
      </div>
    );
  }

  if (!user || !isAdminAuthorized) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xs">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0F2544] text-white">
            <ShieldCheck className="h-6 w-6 text-orange-400" />
          </div>
          <h1 className="mt-4 font-display text-2xl font-bold text-slate-900">
            Login Administrator / Guru
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Masuk menggunakan akun Google terverifikasi untuk mengelola kuis, bank soal multimodal, impor DOCX/PDF, peserta, koreksi uraian, dan laporan analisis.
          </p>

          {authError && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-800">
              {authError}
            </div>
          )}

          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={() => void handleGoogleSignIn()}
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2.5 rounded-xl bg-[#0F2544] px-5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors cursor-pointer"
            >
              <ShieldCheck className="h-4 w-4 text-orange-400" />
              <span>Masuk dengan Google</span>
            </button>

            {user && (
              <button
                type="button"
                onClick={() => void signOut(auth)}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                <span>Keluar dari {user.email}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${
            toast.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {toast.type === 'ok' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Sidebar Navigation */}
        <aside className="lg:col-span-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <p className="text-xs font-semibold text-blue-700">Admin Terautentikasi</p>
              <p className="mt-0.5 truncate text-sm font-bold text-slate-900">
                {user.displayName || 'Guru Pengawas'}
              </p>
              <p className="truncate text-xs text-slate-500">{user.email}</p>
            </div>

            <nav className="space-y-1">
              {(
                [
                  { id: 'quizzes', label: 'Kuis & Editor Soal', icon: Layers },
                  { id: 'bank', label: 'Bank Soal', icon: BookMarked },
                  { id: 'import', label: 'Impor DOCX / PDF', icon: FileUp },
                  { id: 'participants', label: 'Peserta & Kelas', icon: Users },
                  { id: 'grading', label: 'Pengawasan & Nilai', icon: ClipboardCheck },
                  { id: 'analytics', label: 'Analisis & Ekspor', icon: BarChart3 },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3.5 text-left text-sm font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#0F2544] text-white'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${active ? 'text-orange-400' : 'text-slate-500'}`} />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="border-t border-slate-100 pt-3 space-y-2">
              <button
                type="button"
                onClick={() => void refreshAllAdminData()}
                disabled={loadingData}
                className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingData ? 'animate-spin' : ''}`} />
                <span>Segarkan Data</span>
              </button>
              <button
                type="button"
                onClick={() => void signOut(auth)}
                className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Keluar Admin</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Main Workspace */}
        <section className="lg:col-span-9 space-y-6">
          {/* TAB 1: QUIZZES & VISUAL EDITOR */}
          {activeTab === 'quizzes' && (
            <>
              {!editingQuizId ? (
                <div className="space-y-5">
                  <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h1 className="font-display text-xl font-bold text-slate-900">
                        Manajemen Kuis & Penjadwalan
                      </h1>
                      <p className="mt-1 text-xs text-slate-500">
                        {quizzes.length} kuis tersimpan · Kunci jawaban otomatis terenkripsi AES-256-GCM
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleSeedEnglishPack()}
                        className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 cursor-pointer"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Muat Contoh Bahasa Inggris</span>
                      </button>
                      <button
                        type="button"
                        onClick={openNewQuizEditor}
                        className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-orange-600 px-4 text-xs font-semibold text-white hover:bg-orange-700 cursor-pointer"
                      >
                        <Plus className="h-4 w-4" />
                        <span>Buat Kuis Baru</span>
                      </button>
                    </div>
                  </div>

                  {unsyncedLocalDraft && (
                    <div className="flex flex-col gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-3">
                        <CloudOff className="mt-0.5 h-5 w-5 text-orange-600 shrink-0" />
                        <div>
                          <p className="text-sm font-bold text-orange-950">
                            Draf Lokal Belum Tersinkron ke Cloud
                          </p>
                          <p className="mt-0.5 text-xs text-orange-800">
                            Draf &ldquo;{unsyncedLocalDraft.title}&rdquo; ({unsyncedLocalDraft.fullQuestions.length} soal) tersimpan lokal pada{' '}
                            {new Date(unsyncedLocalDraft.savedAt).toLocaleString('id-ID')}.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={restoreUnsyncedLocalDraft}
                          className="min-h-[38px] rounded-xl bg-orange-600 px-3.5 text-xs font-semibold text-white hover:bg-orange-700 cursor-pointer"
                        >
                          Pulihkan &amp; Sinkronkan
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            localStorage.removeItem('sq_admin_quiz_draft_v1');
                            setUnsyncedLocalDraft(null);
                          }}
                          className="min-h-[38px] rounded-xl border border-orange-300 bg-white px-3 text-xs font-semibold text-orange-800 hover:bg-orange-100 cursor-pointer"
                        >
                          Abaikan
                        </button>
                      </div>
                    </div>
                  )}

                  {quizzes.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
                      <Layers className="mx-auto h-10 w-10 text-slate-400" />
                      <h2 className="mt-3 font-display text-base font-semibold text-slate-900">
                        Belum Ada Kuis
                      </h2>
                      <p className="mt-1 text-sm text-slate-600">
                        Klik <strong>Buat Kuis Baru</strong> atau muat paket contoh Bahasa Inggris multimodal untuk langsung menguji sistem.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {quizzes.map((qz) => (
                        <article
                          key={qz.id}
                          className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5"
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                              <span className="font-semibold text-blue-700">{qz.subject}</span>
                              <span>·</span>
                              <span className="font-mono tabular-nums">
                                {qz.questionCount} soal / {qz.totalMaxScore} poin
                              </span>
                              <span>·</span>
                              <span
                                className={`font-semibold ${
                                  qz.status === 'published'
                                    ? 'text-emerald-700'
                                    : qz.status === 'draft'
                                    ? 'text-orange-700'
                                    : 'text-slate-500'
                                }`}
                              >
                                {qz.status === 'published'
                                  ? 'Terbit'
                                  : qz.status === 'draft'
                                  ? 'Draf'
                                  : 'Arsip'}
                              </span>
                            </div>

                            <h2 className="mt-2 font-display text-base font-bold text-slate-900">
                              {qz.title}
                            </h2>
                            <p className="mt-1.5 text-xs text-slate-600">
                              Kelas: <strong>{(qz.classTargets || []).join(', ')}</strong> · Durasi{' '}
                              <span className="font-mono">{qz.durationMinutes}m</span>
                            </p>
                          </div>

                          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                            <button
                              type="button"
                              onClick={() => void openExistingQuizEditor(qz)}
                              className="inline-flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer"
                            >
                              <Edit3 className="h-3.5 w-3.5 text-blue-600" />
                              <span>Edit Soal</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleQuickTogglePublish(qz)}
                              className={`inline-flex min-h-[38px] items-center justify-center rounded-lg border px-3 text-xs font-semibold cursor-pointer ${
                                qz.status === 'published'
                                  ? 'border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                              }`}
                            >
                              {qz.status === 'published' ? 'Jadikan Draf' : 'Terbitkan'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedQuizFilter(qz.id);
                                setActiveTab('analytics');
                              }}
                              className="inline-flex min-h-[38px] items-center justify-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              <BarChart3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void deleteQuizAdmin(qz.id).then(() => {
                                  showMessage('ok', 'Kuis dihapus.');
                                  void refreshAllAdminData();
                                });
                              }}
                              className="inline-flex min-h-[38px] items-center justify-center rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* QUIZ EDITOR FORM */
                <form onSubmit={(e) => void handleSaveQuiz(e)} className="space-y-6">
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <h1 className="font-display text-lg font-bold text-slate-900">
                          {isNewQuiz ? 'Buat Kuis Baru' : 'Edit Kuis & Pengaturan Keamanan'}
                        </h1>
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                          {cloudSyncState === 'saving' ? (
                            <>
                              <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-600" />
                              <span className="text-blue-700">Menyimpan otomatis ke Cloud...</span>
                            </>
                          ) : cloudSyncState === 'saved' ? (
                            <>
                              <Cloud className="h-3.5 w-3.5 text-emerald-600" />
                              <span className="text-emerald-700">
                                Tersimpan online{lastSyncedAt ? ` · ${lastSyncedAt}` : ''}
                              </span>
                            </>
                          ) : cloudSyncState === 'error' ? (
                            <>
                              <CloudOff className="h-3.5 w-3.5 text-orange-600" />
                              <span className="text-orange-700">Tersimpan lokal (gagal sinkron cloud)</span>
                            </>
                          ) : (
                            <span>Autosave Cloud aktif</span>
                          )}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void closeQuizEditorWithFlush()}
                        className="text-xs font-semibold text-slate-500 hover:text-slate-900 cursor-pointer"
                      >
                        Tutup Editor
                      </button>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">Judul Kuis</label>
                        <input
                          type="text"
                          required
                          value={qTitle}
                          onChange={(e) => setQTitle(e.target.value)}
                          placeholder="Contoh: PTS Bahasa Inggris Multimodal Kelas X"
                          className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">Mata Pelajaran</label>
                        <input
                          type="text"
                          required
                          value={qSubject}
                          onChange={(e) => setQSubject(e.target.value)}
                          className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm"
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Target Kelas (pisahkan koma)
                        </label>
                        <input
                          type="text"
                          required
                          value={qClassTargets}
                          onChange={(e) => setQClassTargets(e.target.value)}
                          placeholder="X TJKT 1, X TJKT 2, SEMUA"
                          className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Durasi (Menit)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={360}
                          value={qDuration}
                          onChange={(e) => setQDuration(Number(e.target.value) || 30)}
                          className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">Status</label>
                        <select
                          value={qStatus}
                          onChange={(e) => setQStatus(e.target.value as QuizStatus)}
                          className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm"
                        >
                          <option value="published">Terbit (Aktif untuk Murid)</option>
                          <option value="draft">Draf (Tersembunyi)</option>
                          <option value="archived">Arsip</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">Jadwal Buka</label>
                        <input
                          type="datetime-local"
                          required
                          value={qStartAt}
                          onChange={(e) => setQStartAt(e.target.value)}
                          className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">Jadwal Tutup</label>
                        <input
                          type="datetime-local"
                          required
                          value={qEndAt}
                          onChange={(e) => setQEndAt(e.target.value)}
                          className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Batas Pelanggaran (0 = hanya catat)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={50}
                          value={qMaxViolations}
                          onChange={(e) => setQMaxViolations(Number(e.target.value) || 0)}
                          className="mt-1 w-full min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono text-sm"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-5 pt-1 text-xs font-medium text-slate-700">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={qFullscreen}
                          onChange={(e) => setQFullscreen(e.target.checked)}
                        />
                        <span>Wajib Mode Layar Penuh (Fullscreen API)</span>
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={qShuffle}
                          onChange={(e) => setQShuffle(e.target.checked)}
                        />
                        <span>Acak Urutan Soal per Peserta</span>
                      </label>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Petunjuk Pengerjaan
                      </label>
                      <textarea
                        rows={2}
                        value={qInstructions}
                        onChange={(e) => setQInstructions(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-xs"
                      />
                    </div>
                  </div>

                  {/* Questions List */}
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="font-display text-base font-bold text-slate-900">
                        Daftar Butir Soal ({qQuestions.length} butir · Total{' '}
                        {qQuestions.reduce((s, q) => s + (Number(q.points) || 0), 0)} poin)
                      </h2>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setShowBankPicker(true)}
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                        >
                          <BookMarked className="h-3.5 w-3.5 text-blue-600" />
                          <span>Ambil dari Bank Soal</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setQQuestions((prev) => [
                              ...prev,
                              createBlankQuestion(prev.length + 1),
                            ])
                          }
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer"
                        >
                          <Plus className="h-4 w-4" />
                          <span>Tambah Soal</span>
                        </button>
                      </div>
                    </div>

                    {qQuestions.map((q, idx) => (
                      <AdminQuestionEditor
                        key={q.id}
                        question={q}
                        index={idx}
                        onChange={(updated) => {
                          setQQuestions((prev) => {
                            const next = [...prev];
                            next[idx] = updated;
                            return next;
                          });
                        }}
                        onDelete={() =>
                          setQQuestions((prev) => prev.filter((_, i) => i !== idx))
                        }
                        onSaveToBank={() => {
                          void saveQuestionBankItem({
                            id: uid('bank'),
                            subject: qSubject || 'Umum',
                            tags: [q.type],
                            questionData: q,
                            isNew: true,
                          }).then(() => {
                            showMessage('ok', `Soal #${idx + 1} disimpan ke Bank Soal.`);
                            void refreshAllAdminData();
                          });
                        }}
                      />
                    ))}
                  </div>

                  <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 backdrop-blur-md shadow-md">
                    <span className="text-xs text-slate-600">
                      {cloudSyncState === 'saving'
                        ? 'Menyinkronkan perubahan ke Firestore...'
                        : cloudSyncState === 'saved'
                        ? `Tersimpan otomatis di Cloud Firestore (${lastSyncedAt || 'baru saja'})`
                        : cloudSyncState === 'error'
                        ? 'Gagal sinkron ke Cloud — cadangan lokal aman di browser ini.'
                        : 'Setiap perubahan soal otomatis disinkronkan setiap 2 detik.'}
                    </span>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => void closeQuizEditorWithFlush()}
                        className="min-h-[44px] rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        Tutup
                      </button>
                      {qStatus === 'draft' && (
                        <button
                          type="button"
                          disabled={savingQuiz}
                          onClick={(e) => void handleSaveQuiz(e, 'published')}
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white hover:bg-emerald-700 cursor-pointer disabled:opacity-60"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          <span>Simpan &amp; Terbitkan</span>
                        </button>
                      )}
                      <button
                        type="submit"
                        disabled={savingQuiz}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#0F2544] px-6 text-sm font-semibold text-white hover:bg-blue-700 cursor-pointer disabled:opacity-60"
                      >
                        <Save className="h-4 w-4" />
                        <span>{savingQuiz ? 'Menyegel & Menyimpan...' : 'Simpan & Selesai'}</span>
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* Bank Soal Picker Modal */}
              {showBankPicker && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
                  <div className="w-full max-w-2xl rounded-2xl bg-white p-6 max-h-[82vh] flex flex-col">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <h3 className="font-display text-base font-bold text-slate-900">
                        Pilih Soal dari Bank Soal
                      </h3>
                      <button
                        type="button"
                        onClick={() => setShowBankPicker(false)}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 cursor-pointer"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-4 flex-1 overflow-y-auto space-y-2.5">
                      {bankItems.length === 0 ? (
                        <p className="text-sm text-slate-500 py-8 text-center">
                          Bank soal masih kosong. Simpan soal dari editor atau impor DOCX/PDF.
                        </p>
                      ) : (
                        bankItems.map((b) => (
                          <div
                            key={b.id}
                            className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3.5"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-blue-700">
                                {b.subject} · {b.type} · {b.questionData.points} poin
                              </p>
                              <p className="mt-1 text-sm text-slate-900 line-clamp-2">
                                {b.questionData.prompt}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setQQuestions((prev) => [
                                  ...prev,
                                  {
                                    ...b.questionData,
                                    id: uid('q'),
                                    number: prev.length + 1,
                                  },
                                ]);
                                setShowBankPicker(false);
                              }}
                              className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer"
                            >
                              Sisipkan
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* TAB 2: QUESTION BANK */}
          {activeTab === 'bank' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h1 className="font-display text-xl font-bold text-slate-900">
                      Bank Soal Terstruktur
                    </h1>
                    <p className="mt-1 text-xs text-slate-500">
                      {bankItems.length} butir soal siap pakai ulang lintas kelas & jadwal ujian
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={bankSearch}
                      onChange={(e) => setBankSearch(e.target.value)}
                      placeholder="Cari pertanyaan atau mata pelajaran..."
                      className="w-full min-h-[40px] rounded-xl border border-slate-300 pl-9 pr-3 text-sm"
                    />
                  </div>
                  <select
                    value={bankTypeFilter}
                    onChange={(e) => setBankTypeFilter(e.target.value)}
                    className="min-h-[40px] rounded-xl border border-slate-300 px-3 text-sm"
                  >
                    <option value="all">Semua Tipe Soal</option>
                    <option value="mcq">Pilihan Ganda</option>
                    <option value="complex_mcq">Pilihan Ganda Kompleks</option>
                    <option value="grouping">Mengelompokkan</option>
                    <option value="short_essay">Uraian Singkat</option>
                    <option value="long_essay">Uraian Panjang</option>
                  </select>
                </div>
              </div>

              <div className="space-y-3">
                {bankItems
                  .filter((b) => {
                    const matchType = bankTypeFilter === 'all' || b.type === bankTypeFilter;
                    const q = bankSearch.trim().toLowerCase();
                    const matchText =
                      !q ||
                      b.questionData.prompt.toLowerCase().includes(q) ||
                      b.subject.toLowerCase().includes(q);
                    return matchType && matchText;
                  })
                  .map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-blue-700">
                          {item.subject} · {item.type} ·{' '}
                          <span className="font-mono">{item.questionData.points} poin</span>
                        </p>
                        <p className="text-sm font-medium text-slate-900">
                          {item.questionData.prompt}
                        </p>
                        {item.questionData.stimulusText && (
                          <p className="text-xs text-slate-500 line-clamp-2">
                            Stimulus: {item.questionData.stimulusText}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void deleteQuestionBankItem(item.id).then(() => {
                            showMessage('ok', 'Butir bank soal dihapus.');
                            void refreshAllAdminData();
                          });
                        }}
                        className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Hapus</span>
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* TAB 3: DOCX / PDF IMPORTER + TEMPLATE + MANUAL VERIFICATION */}
          {activeTab === 'import' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h1 className="font-display text-xl font-bold text-slate-900">
                      Impor Soal DOCX / PDF & Verifikasi Manual
                    </h1>
                    <p className="mt-1 text-xs text-slate-500">
                      Unduh template resmi DOCX untuk hasil parsing terbaik (5 tipe soal + teks/gambar/audio multimodal).
                    </p>
                  </div>
                  <a
                    href="/api/import/template.docx"
                    className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 text-xs font-semibold text-blue-700 hover:bg-blue-100 shrink-0"
                  >
                    <Download className="h-4 w-4" />
                    <span>Unduh Template .DOCX</span>
                  </a>
                </div>

                <label className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center hover:border-blue-500 hover:bg-blue-50/40 transition-colors cursor-pointer">
                  <Upload className="h-8 w-8 text-blue-600" />
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    {importingFile
                      ? 'Sedang mengekstrak struktur soal...'
                      : 'Pilih file .DOCX atau .PDF untuk dipindai'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Mendukung template bertag [QUESTION] maupun soal bernomor otomatis (maks. 15 MB)
                  </p>
                  <input
                    type="file"
                    accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    disabled={importingFile}
                    onChange={(e) => void handleUploadImportDoc(e)}
                  />
                </label>
              </div>

              {parsedImports.length > 0 && (
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="font-display text-base font-bold text-slate-900">
                        Pratinjau & Verifikasi Manual ({parsedImports.length} soal dari {importFilename})
                      </h2>
                      <p className="text-xs text-slate-700">
                        Periksa pertanyaan, tipe, dan kunci jawaban di bawah sebelum mengimpor.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={importTargetQuizId}
                        onChange={(e) => setImportTargetQuizId(e.target.value)}
                        className="min-h-[40px] rounded-xl border border-slate-300 bg-white px-3 text-xs font-medium"
                      >
                        <option value="NEW_DRAFT">Buat Kuis Draf Baru</option>
                        {quizzes.map((qz) => (
                          <option key={qz.id} value={qz.id}>
                            Tambahkan ke: {qz.title.slice(0, 32)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void commitImportedQuestions('quiz')}
                        className="min-h-[40px] rounded-xl bg-[#0F2544] px-4 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer"
                      >
                        Impor ke Kuis
                      </button>
                      <button
                        type="button"
                        onClick={() => void commitImportedQuestions('bank')}
                        className="min-h-[40px] rounded-xl border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer"
                      >
                        Simpan ke Bank Soal
                      </button>
                    </div>
                  </div>

                  {parsedImports.map((item, idx) => (
                    <div
                      key={item.tempId}
                      className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono font-bold text-[#0F2544]">#{idx + 1}</span>
                          <select
                            value={item.type}
                            onChange={(e) => {
                              const nextType = e.target.value as QuestionType;
                              setParsedImports((prev) =>
                                prev.map((p, i) => (i === idx ? { ...p, type: nextType } : p))
                              );
                            }}
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold"
                          >
                            <option value="mcq">Pilihan Ganda</option>
                            <option value="complex_mcq">Pilihan Ganda Kompleks</option>
                            <option value="grouping">Mengelompokkan</option>
                            <option value="short_essay">Uraian Singkat</option>
                            <option value="long_essay">Uraian Panjang</option>
                          </select>
                          <input
                            type="number"
                            value={item.points}
                            onChange={(e) => {
                              const pts = Number(e.target.value) || 0;
                              setParsedImports((prev) =>
                                prev.map((p, i) => (i === idx ? { ...p, points: pts } : p))
                              );
                            }}
                            className="w-16 rounded-lg border border-slate-300 px-2 py-1 font-mono text-xs"
                          />
                          <span className="text-slate-500">poin</span>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setParsedImports((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-xs font-semibold text-red-600 hover:underline cursor-pointer"
                        >
                          Buang
                        </button>
                      </div>

                      {item.warnings.length > 0 && (
                        <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs text-orange-900">
                          {item.warnings.map((w, wi) => (
                            <p key={wi}>• {w}</p>
                          ))}
                        </div>
                      )}

                      {item.stimulusText && (
                        <textarea
                          rows={2}
                          value={item.stimulusText}
                          onChange={(e) => {
                            const val = e.target.value;
                            setParsedImports((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, stimulusText: val } : p))
                            );
                          }}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs"
                        />
                      )}

                      <textarea
                        rows={2}
                        value={item.prompt}
                        onChange={(e) => {
                          const val = e.target.value;
                          setParsedImports((prev) =>
                            prev.map((p, i) => (i === idx ? { ...p, prompt: val } : p))
                          );
                        }}
                        className="w-full rounded-xl border border-slate-300 p-2.5 text-sm font-medium"
                      />

                      {item.options.length > 0 && (
                        <div className="grid gap-1.5 sm:grid-cols-2 text-xs">
                          {item.options.map((opt) => {
                            const isKey =
                              item.type === 'mcq'
                                ? item.correctOptionId === opt.id
                                : item.correctOptionIds.includes(opt.id);
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  setParsedImports((prev) =>
                                    prev.map((p, i) => {
                                      if (i !== idx) return p;
                                      if (p.type === 'mcq') {
                                        return { ...p, correctOptionId: opt.id };
                                      }
                                      const nextIds = p.correctOptionIds.includes(opt.id)
                                        ? p.correctOptionIds.filter((x) => x !== opt.id)
                                        : [...p.correctOptionIds, opt.id];
                                      return { ...p, correctOptionIds: nextIds };
                                    })
                                  );
                                }}
                                className={`flex items-center gap-2 rounded-lg border p-2 text-left cursor-pointer ${
                                  isKey
                                    ? 'border-emerald-600 bg-emerald-50 text-emerald-950 font-semibold'
                                    : 'border-slate-200 bg-white text-slate-700'
                                }`}
                              >
                                <span className="font-mono font-bold">{opt.label}.</span>
                                <span className="truncate">{opt.text}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: PARTICIPANTS ROSTER */}
          {activeTab === 'participants' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
                <h1 className="font-display text-xl font-bold text-slate-900">
                  Manajemen Peserta & Kelas
                </h1>

                <form onSubmit={(e) => void handleAddParticipant(e)} className="grid gap-3 sm:grid-cols-4">
                  <input
                    type="text"
                    required
                    value={pNis}
                    onChange={(e) => setPNis(e.target.value)}
                    placeholder="NIS (mis. 2026004)"
                    className="min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono text-sm"
                  />
                  <input
                    type="text"
                    required
                    value={pName}
                    onChange={(e) => setPName(e.target.value)}
                    placeholder="Nama Lengkap Murid"
                    className="min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm sm:col-span-2"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={pClass}
                      onChange={(e) => setPClass(e.target.value)}
                      placeholder="Kelas"
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm"
                    />
                    <button
                      type="submit"
                      className="min-h-[42px] shrink-0 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer"
                    >
                      Tambah
                    </button>
                  </div>
                </form>

                <div className="border-t border-slate-100 pt-4">
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Impor Massal (Tempel CSV/TSV dari Excel: <span className="font-mono">NIS, Nama, Kelas</span> per baris)
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <textarea
                      rows={2}
                      value={bulkRosterText}
                      onChange={(e) => setBulkRosterText(e.target.value)}
                      placeholder={'2026010, Budi Santoso, X TJKT 1\n2026011, Siti Aminah, X TJKT 2'}
                      className="flex-1 rounded-xl border border-slate-300 p-2.5 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => void handleBulkRosterImport()}
                      className="min-h-[42px] shrink-0 rounded-xl bg-[#0F2544] px-4 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer"
                    >
                      Impor Massal
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
                  <p className="text-sm font-semibold text-slate-900">
                    Daftar Peserta ({participants.length})
                  </p>
                  <input
                    type="text"
                    value={participantSearch}
                    onChange={(e) => setParticipantSearch(e.target.value)}
                    placeholder="Filter nama / NIS / kelas..."
                    className="min-h-[36px] rounded-lg border border-slate-300 px-3 text-xs"
                  />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                      <tr>
                        <th className="px-4 py-3">NIS</th>
                        <th className="px-4 py-3">Nama Lengkap</th>
                        <th className="px-4 py-3">Kelas</th>
                        <th className="px-4 py-3 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {participants
                        .filter((p) => {
                          const q = participantSearch.trim().toLowerCase();
                          return (
                            !q ||
                            p.name.toLowerCase().includes(q) ||
                            p.nis.toLowerCase().includes(q) ||
                            p.className.toLowerCase().includes(q)
                          );
                        })
                        .map((p) => (
                          <tr key={p.id} className="hover:bg-slate-50">
                            <td className="px-4 py-2.5 font-mono text-xs text-slate-700">
                              {p.nis}
                            </td>
                            <td className="px-4 py-2.5 font-medium text-slate-900">{p.name}</td>
                            <td className="px-4 py-2.5 text-slate-600">{p.className}</td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  void deleteParticipantAdmin(p.id).then(() => {
                                    showMessage('ok', 'Peserta dihapus.');
                                    void refreshAllAdminData();
                                  });
                                }}
                                className="text-xs font-semibold text-red-600 hover:underline cursor-pointer"
                              >
                                Hapus
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: PROCTORING MONITOR & ESSAY GRADING */}
          {activeTab === 'grading' && (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h1 className="font-display text-xl font-bold text-slate-900">
                    Pengawasan Pelanggaran & Koreksi Uraian
                  </h1>
                  <p className="mt-1 text-xs text-slate-500">
                    Verifikasi tanda terima HMAC server, pantau pelanggaran, dan nilai jawaban uraian panjang.
                  </p>
                </div>
                <select
                  value={selectedQuizFilter}
                  onChange={(e) => setSelectedQuizFilter(e.target.value)}
                  className="min-h-[40px] rounded-xl border border-slate-300 px-3 text-xs font-medium"
                >
                  <option value="ALL">Semua Kuis ({attempts.length})</option>
                  {quizzes.map((qz) => (
                    <option key={qz.id} value={qz.id}>
                      {qz.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                      <tr>
                        <th className="px-4 py-3">Peserta</th>
                        <th className="px-4 py-3">Kuis</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Skor</th>
                        <th className="px-4 py-3 text-right">Pelanggaran</th>
                        <th className="px-4 py-3">Integritas</th>
                        <th className="px-4 py-3 text-right">Tindakan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredAttempts.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                            Belum ada peserta yang mengerjakan kuis ini.
                          </td>
                        </tr>
                      ) : (
                        filteredAttempts.map((att) => {
                          const receiptOk =
                            att.status === 'in_progress'
                              ? null
                              : receiptValidity[att.id] !== false;
                          return (
                            <tr key={att.id} className="hover:bg-slate-50">
                              <td className="px-4 py-3">
                                <p className="font-semibold text-slate-900">{att.studentName}</p>
                                <p className="font-mono text-xs text-slate-500">
                                  {att.nis} · {att.className}
                                </p>
                              </td>
                              <td className="px-4 py-3 text-xs text-slate-700 max-w-[180px] truncate">
                                {att.quizTitle}
                              </td>
                              <td className="px-4 py-3 text-xs font-semibold">
                                {att.status === 'graded'
                                  ? 'Sudah Dinilai'
                                  : att.status === 'submitted'
                                  ? 'Terkumpul'
                                  : 'Sedang Ujian'}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-xs font-bold tabular-nums text-slate-900">
                                {att.totalScore} / {att.maxScore}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-xs font-bold tabular-nums">
                                <span
                                  className={
                                    att.violationCount > 0 ? 'text-orange-600' : 'text-slate-600'
                                  }
                                >
                                  {att.violationCount}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-xs">
                                {receiptOk === null ? (
                                  <span className="text-slate-500">Aktif</span>
                                ) : receiptOk ? (
                                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                    Valid
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                                    <ShieldAlert className="h-3.5 w-3.5" />
                                    Anomali
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setGradingAttempt(att);
                                    const initScores: Record<string, number> = {};
                                    Object.entries(att.itemResults || {}).forEach(([qId, r]) => {
                                      if (!r.isAutoGraded) initScores[qId] = r.earnedPoints;
                                    });
                                    setManualScoresDraft(initScores);
                                    setManualFeedbackDraft(att.manualFeedback || {});
                                  }}
                                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer"
                                >
                                  Periksa / Nilai
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void deleteAttemptAdmin(att.id).then(() => {
                                      showMessage('ok', 'Data percobaan dihapus.');
                                      void refreshAllAdminData();
                                    });
                                  }}
                                  className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer"
                                >
                                  Hapus
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Essay Grading & Violation Detail Modal */}
              {gradingAttempt && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
                  <div className="w-full max-w-3xl rounded-2xl bg-white p-6 max-h-[88vh] flex flex-col">
                    <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                      <div>
                        <h3 className="font-display text-lg font-bold text-slate-900">
                          Evaluasi Jawaban & Log Keamanan — {gradingAttempt.studentName}
                        </h3>
                        <p className="text-xs text-slate-500">
                          NIS {gradingAttempt.nis} · {gradingAttempt.className} ·{' '}
                          {gradingAttempt.quizTitle}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setGradingAttempt(null)}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 cursor-pointer"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mt-4 flex-1 overflow-y-auto space-y-5 pr-1">
                      {/* Violations Log */}
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs font-bold text-slate-800">
                          Log Aktivitas Pengawasan ({gradingAttempt.violationCount} kejadian)
                        </p>
                        {(gradingAttempt.violationsSummary || []).length === 0 ? (
                          <p className="mt-1 text-xs text-emerald-700">
                            Tidak ada pelanggaran tercatat selama sesi ujian ini.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-1 text-xs text-slate-700 max-h-36 overflow-y-auto">
                            {gradingAttempt.violationsSummary.map((v, i) => (
                              <li key={i} className="font-mono">
                                [{new Date(v.timestamp).toLocaleTimeString('id-ID')}] {v.type}:{' '}
                                {v.detail}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {/* Questions & Answers */}
                      {(() => {
                        const quiz = quizzes.find((q) => q.id === gradingAttempt.quizId);
                        if (!quiz) return null;
                        return quiz.questions.map((q) => {
                          const res = gradingAttempt.itemResults?.[q.id];
                          const ans = gradingAttempt.answers?.[q.id];
                          const needsManual = q.type === 'long_essay' || q.type === 'short_essay';
                          return (
                            <div
                              key={q.id}
                              className="rounded-xl border border-slate-200 p-4 space-y-2.5"
                            >
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-[#0F2544]">
                                  Soal #{q.number} ({q.type})
                                </span>
                                <span className="font-mono text-slate-600">
                                  Skor saat ini: {res?.earnedPoints ?? 0} / {q.points}
                                </span>
                              </div>
                              <p className="text-sm font-medium text-slate-900">{q.prompt}</p>
                              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-800 whitespace-pre-wrap">
                                {typeof ans === 'string'
                                  ? ans || '(Kosong)'
                                  : JSON.stringify(ans || '(Kosong)')}
                              </div>

                              {needsManual && (
                                <div className="grid gap-3 sm:grid-cols-3 pt-2 border-t border-slate-100">
                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-600">
                                      Beri Nilai (0 - {q.points})
                                    </label>
                                    <input
                                      type="number"
                                      min={0}
                                      max={q.points}
                                      value={
                                        q.id in manualScoresDraft
                                          ? manualScoresDraft[q.id]
                                          : res?.earnedPoints ?? 0
                                      }
                                      onChange={(e) =>
                                        setManualScoresDraft((prev) => ({
                                          ...prev,
                                          [q.id]: Number(e.target.value) || 0,
                                        }))
                                      }
                                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-sm"
                                    />
                                  </div>
                                  <div className="sm:col-span-2">
                                    <label className="block text-[11px] font-semibold text-slate-600">
                                      Catatan / Umpan Balik Guru
                                    </label>
                                    <input
                                      type="text"
                                      value={manualFeedbackDraft[q.id] || ''}
                                      onChange={(e) =>
                                        setManualFeedbackDraft((prev) => ({
                                          ...prev,
                                          [q.id]: e.target.value,
                                        }))
                                      }
                                      placeholder="Umpan balik singkat..."
                                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>

                    <div className="mt-4 flex justify-end gap-3 border-t border-slate-100 pt-4">
                      <button
                        type="button"
                        onClick={() => setGradingAttempt(null)}
                        className="min-h-[42px] rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 cursor-pointer"
                      >
                        Tutup
                      </button>
                      <button
                        type="button"
                        disabled={savingGrade}
                        onClick={() => {
                          setSavingGrade(true);
                          void saveManualEssayGradeAdmin({
                            attempt: gradingAttempt,
                            manualScoresByQuestion: manualScoresDraft,
                            manualFeedback: manualFeedbackDraft,
                          })
                            .then(() => {
                              showMessage('ok', 'Nilai uraian berhasil diperbarui.');
                              setGradingAttempt(null);
                              void refreshAllAdminData();
                            })
                            .catch((err) =>
                              showMessage(
                                'err',
                                err instanceof Error ? err.message : 'Gagal menyimpan nilai.'
                              )
                            )
                            .finally(() => setSavingGrade(false));
                        }}
                        className="min-h-[42px] rounded-xl bg-orange-600 px-5 text-sm font-semibold text-white hover:bg-orange-700 cursor-pointer disabled:opacity-60"
                      >
                        {savingGrade ? 'Menyimpan...' : 'Simpan Nilai Final'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 6: ANALYTICS & EXCEL / CSV / PDF EXPORT */}
          {activeTab === 'analytics' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h1 className="font-display text-xl font-bold text-slate-900">
                    Analisis Hasil & Ekspor Laporan
                  </h1>
                  <p className="mt-1 text-xs text-slate-500">
                    Statistik performa murid, analisis tingkat kesukaran butir soal, dan ekspor dokumen resmi.
                  </p>
                </div>

                <select
                  value={activeAnalyticsQuiz?.id || ''}
                  onChange={(e) => setSelectedQuizFilter(e.target.value)}
                  className="min-h-[42px] rounded-xl border border-slate-300 px-3 text-xs font-semibold"
                >
                  {quizzes.map((qz) => (
                    <option key={qz.id} value={qz.id}>
                      {qz.title}
                    </option>
                  ))}
                </select>
              </div>

              {!activeAnalyticsQuiz ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
                  Buat atau muat kuis terlebih dahulu untuk melihat analisis hasil.
                </div>
              ) : (
                <>
                  {/* Export Action Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-[#0F2544] p-5 text-white">
                    <div>
                      <p className="font-display text-sm font-bold">
                        Unduh Laporan: {activeAnalyticsQuiz.title}
                      </p>
                      <p className="text-xs text-slate-300">
                        Mencakup rekap nilai, log pelanggaran, dan analisis per nomor ({analyticsAttempts.length} peserta).
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          exportResultsToExcel(
                            activeAnalyticsQuiz,
                            analyticsAttempts,
                            receiptValidity
                          )
                        }
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer"
                      >
                        <FileSpreadsheet className="h-4 w-4" />
                        <span>Excel (.xlsx)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          exportResultsToCsv(activeAnalyticsQuiz, analyticsAttempts)
                        }
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer"
                      >
                        <Download className="h-4 w-4" />
                        <span>CSV</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          exportResultsToPdf(
                            activeAnalyticsQuiz,
                            analyticsAttempts,
                            receiptValidity
                          )
                        }
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-orange-600 px-3.5 text-xs font-semibold text-white hover:bg-orange-700 cursor-pointer"
                      >
                        <FileText className="h-4 w-4" />
                        <span>PDF Resmi</span>
                      </button>
                    </div>
                  </div>

                  {/* KPI Summary Grid */}
                  {(() => {
                    const count = analyticsAttempts.length;
                    const scores = analyticsAttempts.map((a) => a.totalScore);
                    const avg =
                      count > 0
                        ? Math.round((scores.reduce((s, v) => s + v, 0) / count) * 100) / 100
                        : 0;
                    const highest = count > 0 ? Math.max(...scores) : 0;
                    const passCount = analyticsAttempts.filter(
                      (a) => a.maxScore > 0 && a.totalScore / a.maxScore >= 0.7
                    ).length;
                    const totalVio = analyticsAttempts.reduce(
                      (s, a) => s + a.violationCount,
                      0
                    );

                    return (
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-2xl border border-slate-200 bg-white p-5">
                          <p className="text-xs text-slate-500">Total Peserta</p>
                          <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                            {count}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-5">
                          <p className="text-xs text-slate-500">Rata-Rata Nilai</p>
                          <p className="mt-1 font-mono text-2xl font-bold text-blue-700 tabular-nums">
                            {avg} / {activeAnalyticsQuiz.totalMaxScore}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-5">
                          <p className="text-xs text-slate-500">Ketuntasan (&ge;70%) & Tertinggi</p>
                          <p className="mt-1 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
                            {passCount}/{count} · {highest}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-5">
                          <p className="text-xs text-slate-500">Total Insiden Pengawasan</p>
                          <p className="mt-1 font-mono text-2xl font-bold text-orange-600 tabular-nums">
                            {totalVio}
                          </p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Item Analysis Table */}
                  <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                    <div className="border-b border-slate-200 px-5 py-3.5">
                      <h2 className="font-display text-sm font-bold text-slate-900">
                        Analisis Penguasaan Per Butir Soal
                      </h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                          <tr>
                            <th className="px-4 py-3">No</th>
                            <th className="px-4 py-3">Tipe</th>
                            <th className="px-4 py-3">Ringkasan Pertanyaan</th>
                            <th className="px-4 py-3 text-right">Bobot</th>
                            <th className="px-4 py-3 text-right">Rata-rata</th>
                            <th className="px-4 py-3 text-right">Penguasaan</th>
                            <th className="px-4 py-3">Kategori</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {activeAnalyticsQuiz.questions.map((q) => {
                            const itemScores = analyticsAttempts.map(
                              (a) => a.itemResults?.[q.id]?.earnedPoints ?? 0
                            );
                            const avg =
                              itemScores.length > 0
                                ? itemScores.reduce((s, v) => s + v, 0) / itemScores.length
                                : 0;
                            const pct =
                              q.points > 0 ? Math.round((avg / q.points) * 100) : 0;
                            const category =
                              pct >= 70 ? 'Mudah' : pct >= 35 ? 'Sedang' : 'Sukar';
                            return (
                              <tr key={q.id} className="hover:bg-slate-50">
                                <td className="px-4 py-3 font-mono text-xs font-bold">
                                  {q.number}
                                </td>
                                <td className="px-4 py-3 text-xs text-slate-600">{q.type}</td>
                                <td className="px-4 py-3 text-xs text-slate-900 max-w-md truncate">
                                  {q.prompt}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                                  {q.points}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                                  {Math.round(avg * 100) / 100}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-xs font-bold tabular-nums text-blue-700">
                                  {pct}%
                                </td>
                                <td className="px-4 py-3 text-xs font-semibold">
                                  {category}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
