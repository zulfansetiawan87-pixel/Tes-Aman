import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
  handleFirestoreError,
} from './firebase.ts';
import type {
  FullQuestion,
  ParticipantRecord,
  PublicQuestion,
  QuestionBankItem,
  QuestionKey,
  QuizAttempt,
  QuizDocument,
  QuizKeyBundle,
  QuizStatus,
  StudentAnswerValue,
  ViolationSummaryEntry,
  ViolationType,
} from '../types/quiz.ts';

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

export function splitQuestionToPublicAndKey(
  q: FullQuestion,
  index: number
): { publicQuestion: PublicQuestion; key: QuestionKey } {
  const publicQuestion: PublicQuestion = {
    id: q.id,
    number: index + 1,
    type: q.type,
    prompt: q.prompt.trim(),
    points: Number(q.points) || 0,
    ...(q.stimulusText ? { stimulusText: q.stimulusText } : {}),
    ...(q.stimulusImageUrl ? { stimulusImageUrl: q.stimulusImageUrl } : {}),
    ...(q.stimulusAudioUrl ? { stimulusAudioUrl: q.stimulusAudioUrl } : {}),
    ...(q.stimulusCaption ? { stimulusCaption: q.stimulusCaption } : {}),
    ...(q.audioPlayLimit ? { audioPlayLimit: Number(q.audioPlayLimit) } : {}),
    ...(q.options && q.options.length > 0 ? { options: q.options } : {}),
    ...(q.categories && q.categories.length > 0 ? { categories: q.categories } : {}),
    ...(q.items && q.items.length > 0 ? { items: q.items } : {}),
    ...(typeof q.caseSensitive === 'boolean' ? { caseSensitive: q.caseSensitive } : {}),
  };

  const key: QuestionKey = {
    questionId: q.id,
    type: q.type,
    points: Number(q.points) || 0,
    ...(q.correctOptionId ? { correctOptionId: q.correctOptionId } : {}),
    ...(q.correctOptionIds ? { correctOptionIds: q.correctOptionIds } : {}),
    ...(q.correctMapping ? { correctMapping: q.correctMapping } : {}),
    ...(q.acceptedAnswers ? { acceptedAnswers: q.acceptedAnswers } : {}),
    ...(q.rubricKeywords ? { rubricKeywords: q.rubricKeywords } : {}),
    ...(q.rubricNotes ? { rubricNotes: q.rubricNotes } : {}),
  };

  return { publicQuestion, key };
}

export function mergePublicAndKeys(
  questions: PublicQuestion[],
  keys: QuestionKey[]
): FullQuestion[] {
  const keyMap = new Map(keys.map((k) => [k.questionId, k]));
  return questions.map((q) => {
    const k = keyMap.get(q.id);
    return {
      ...q,
      correctOptionId: k?.correctOptionId,
      correctOptionIds: k?.correctOptionIds,
      correctMapping: k?.correctMapping,
      acceptedAnswers: k?.acceptedAnswers,
      rubricKeywords: k?.rubricKeywords,
      rubricNotes: k?.rubricNotes,
    };
  });
}

async function getAdminIdToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Admin belum login.');
  return await user.getIdToken();
}

export async function ensureAdminProfile(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user || !user.email || !user.emailVerified) return false;
  const emailLower = user.email.toLowerCase();

  try {
    const adminRef = doc(db, 'admins', user.uid);
    const snap = await getDoc(adminRef);
    if (snap.exists()) return true;

    if (emailLower === BOOTSTRAPPED_ADMIN_EMAIL) {
      await setDoc(adminRef, {
        uid: user.uid,
        email: emailLower,
        displayName: user.displayName || 'Super Admin',
        role: 'super_admin',
        createdAt: serverTimestamp(),
      });
      return true;
    }

    const inviteRef = doc(db, 'adminInvites', emailLower);
    const inviteSnap = await getDoc(inviteRef);
    if (inviteSnap.exists()) {
      await setDoc(adminRef, {
        uid: user.uid,
        email: emailLower,
        displayName: user.displayName || emailLower,
        role: 'teacher_admin',
        createdAt: serverTimestamp(),
      });
      return true;
    }
    return false;
  } catch (error) {
    handleFirestoreError(error, 'write', `admins/${user.uid}`);
  }
}

export async function saveQuizWithSealedKeys(params: {
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
  isNew: boolean;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Harap login sebagai Admin terlebih dahulu.');

  const quizId = sanitizeId(params.quizId);
  const publicQuestions: PublicQuestion[] = [];
  const keys: QuestionKey[] = [];
  let totalMaxScore = 0;

  params.fullQuestions.forEach((fq, idx) => {
    const { publicQuestion, key } = splitQuestionToPublicAndKey(fq, idx);
    publicQuestions.push(publicQuestion);
    keys.push(key);
    totalMaxScore += Number(fq.points) || 0;
  });

  const token = await getAdminIdToken();
  const sealRes = await fetch('/api/admin/seal-keys', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ quizId, keys }),
  });

  if (!sealRes.ok) {
    const errBody = await sealRes.json().catch(() => ({}));
    throw new Error(
      errBody.error || `Gagal menyegel kunci jawaban di server (HTTP ${sealRes.status}).`
    );
  }
  const { sealedKeyPack } = (await sealRes.json()) as { sealedKeyPack: string };

  const quizDocRef = doc(db, 'quizzes', quizId);
  const quizPayload: Record<string, unknown> = {
    id: quizId,
    title: params.title.trim().slice(0, 200),
    subject: params.subject.trim().slice(0, 100),
    description: params.description.trim().slice(0, 1000),
    instructions: params.instructions.trim().slice(0, 5000),
    classTargets: params.classTargets.slice(0, 30),
    status: params.status,
    startAt: params.startAt,
    endAt: params.endAt,
    durationMinutes: Math.max(1, Math.min(360, Number(params.durationMinutes) || 30)),
    shuffleQuestions: Boolean(params.shuffleQuestions),
    requireFullscreen: Boolean(params.requireFullscreen),
    maxViolations: Math.max(0, Math.min(50, Number(params.maxViolations) || 0)),
    questions: publicQuestions,
    totalMaxScore: Math.round(totalMaxScore * 100) / 100,
    questionCount: publicQuestions.length,
    sealedKeyPack,
    updatedAt: serverTimestamp(),
  };

  try {
    if (params.isNew) {
      await setDoc(quizDocRef, {
        ...quizPayload,
        createdByUid: user.uid,
        createdAt: serverTimestamp(),
      });
    } else {
      const existingSnap = await getDoc(quizDocRef);
      if (existingSnap.exists()) {
        const existingData = existingSnap.data();
        await setDoc(quizDocRef, {
          ...quizPayload,
          createdByUid: existingData.createdByUid || user.uid,
          createdAt: existingData.createdAt || serverTimestamp(),
        });
      } else {
        await setDoc(quizDocRef, {
          ...quizPayload,
          createdByUid: user.uid,
          createdAt: serverTimestamp(),
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, 'write', `quizzes/${quizId}`);
  }

  try {
    const keyDocRef = doc(db, 'quizKeys', quizId);
    await setDoc(keyDocRef, {
      quizId,
      keys,
      updatedByUid: user.uid,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, 'write', `quizKeys/${quizId}`);
  }
}

export async function listAllQuizzesAdmin(): Promise<QuizDocument[]> {
  try {
    const q = query(collection(db, 'quizzes'), orderBy('updatedAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as QuizDocument);
  } catch (error) {
    handleFirestoreError(error, 'list', 'quizzes');
  }
}

export async function listPublishedQuizzesForStudent(): Promise<QuizDocument[]> {
  try {
    const q = query(collection(db, 'quizzes'), where('status', '==', 'published'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as QuizDocument);
  } catch (error) {
    handleFirestoreError(error, 'list', 'quizzes');
  }
}

export async function getQuizKeysAdmin(quizId: string): Promise<QuestionKey[]> {
  try {
    const snap = await getDoc(doc(db, 'quizKeys', quizId));
    if (!snap.exists()) return [];
    return (snap.data() as QuizKeyBundle).keys || [];
  } catch (error) {
    handleFirestoreError(error, 'get', `quizKeys/${quizId}`);
  }
}

export async function deleteQuizAdmin(quizId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'quizzes', quizId));
    await deleteDoc(doc(db, 'quizKeys', quizId)).catch(() => undefined);
  } catch (error) {
    handleFirestoreError(error, 'delete', `quizzes/${quizId}`);
  }
}

// Question Bank CRUD
export async function listQuestionBankAdmin(): Promise<QuestionBankItem[]> {
  try {
    const q = query(collection(db, 'questionBank'), orderBy('updatedAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as QuestionBankItem);
  } catch (error) {
    handleFirestoreError(error, 'list', 'questionBank');
  }
}

export async function saveQuestionBankItem(params: {
  id: string;
  subject: string;
  tags: string[];
  questionData: FullQuestion;
  isNew: boolean;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Admin belum login.');
  const id = sanitizeId(params.id);
  const ref = doc(db, 'questionBank', id);
  try {
    if (params.isNew) {
      await setDoc(ref, {
        id,
        subject: params.subject.trim().slice(0, 100),
        type: params.questionData.type,
        tags: params.tags.slice(0, 10),
        questionData: params.questionData,
        createdByUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existing = await getDoc(ref);
      const existingData = existing.exists() ? existing.data() : {};
      await setDoc(ref, {
        id,
        subject: params.subject.trim().slice(0, 100),
        type: params.questionData.type,
        tags: params.tags.slice(0, 10),
        questionData: params.questionData,
        createdByUid: existingData.createdByUid || user.uid,
        createdAt: existingData.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, 'write', `questionBank/${id}`);
  }
}

export async function deleteQuestionBankItem(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'questionBank', id));
  } catch (error) {
    handleFirestoreError(error, 'delete', `questionBank/${id}`);
  }
}

// Participants CRUD
export async function listParticipantsAdmin(): Promise<ParticipantRecord[]> {
  try {
    const q = query(collection(db, 'participants'), orderBy('className', 'asc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as ParticipantRecord);
  } catch (error) {
    handleFirestoreError(error, 'list', 'participants');
  }
}

export async function saveParticipantAdmin(params: {
  id: string;
  nis: string;
  name: string;
  className: string;
  active: boolean;
  isNew: boolean;
}): Promise<void> {
  const id = sanitizeId(params.id);
  const ref = doc(db, 'participants', id);
  try {
    if (params.isNew) {
      await setDoc(ref, {
        id,
        nis: params.nis.trim().slice(0, 40),
        name: params.name.trim().slice(0, 120),
        className: params.className.trim().slice(0, 60),
        active: params.active,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existing = await getDoc(ref);
      const createdAt = existing.exists() ? existing.data().createdAt : serverTimestamp();
      await setDoc(ref, {
        id,
        nis: params.nis.trim().slice(0, 40),
        name: params.name.trim().slice(0, 120),
        className: params.className.trim().slice(0, 60),
        active: params.active,
        createdAt,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, 'write', `participants/${id}`);
  }
}

export async function deleteParticipantAdmin(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'participants', id));
  } catch (error) {
    handleFirestoreError(error, 'delete', `participants/${id}`);
  }
}

// Student Attempt Lifecycle
export async function createAttemptInFirestore(attempt: Omit<QuizAttempt, 'createdAt' | 'updatedAt'>): Promise<void> {
  try {
    await setDoc(doc(db, 'attempts', attempt.id), {
      ...attempt,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, 'create', `attempts/${attempt.id}`);
  }
}

export async function getAttemptById(attemptId: string): Promise<QuizAttempt | null> {
  try {
    const snap = await getDoc(doc(db, 'attempts', attemptId));
    return snap.exists() ? (snap.data() as QuizAttempt) : null;
  } catch (error) {
    handleFirestoreError(error, 'get', `attempts/${attemptId}`);
  }
}

export async function autosaveAttemptProgress(
  attemptId: string,
  payload: {
    answers: Record<string, StudentAnswerValue>;
    flaggedQuestions: string[];
    currentQuestionIndex: number;
    violationCount: number;
    violationsSummary: ViolationSummaryEntry[];
  }
): Promise<void> {
  try {
    await updateDoc(doc(db, 'attempts', attemptId), {
      answers: payload.answers,
      flaggedQuestions: payload.flaggedQuestions.slice(0, 200),
      currentQuestionIndex: payload.currentQuestionIndex,
      violationCount: payload.violationCount,
      violationsSummary: payload.violationsSummary.slice(0, 100),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, 'update', `attempts/${attemptId}`);
  }
}

export async function finalizeAttemptInFirestore(
  attemptId: string,
  payload: {
    answers: Record<string, StudentAnswerValue>;
    flaggedQuestions: string[];
    currentQuestionIndex: number;
    violationCount: number;
    violationsSummary: ViolationSummaryEntry[];
    submittedAt: string;
    autoSubmitted: boolean;
    objectiveScore: number;
    maxObjectiveScore: number;
    totalScore: number;
    maxScore: number;
    itemResults: QuizAttempt['itemResults'];
    serverReceipt: string;
  }
): Promise<void> {
  try {
    await updateDoc(doc(db, 'attempts', attemptId), {
      answers: payload.answers,
      flaggedQuestions: payload.flaggedQuestions.slice(0, 200),
      currentQuestionIndex: payload.currentQuestionIndex,
      violationCount: payload.violationCount,
      violationsSummary: payload.violationsSummary.slice(0, 100),
      status: 'submitted',
      submittedAt: payload.submittedAt,
      autoSubmitted: payload.autoSubmitted,
      objectiveScore: payload.objectiveScore,
      maxObjectiveScore: payload.maxObjectiveScore,
      totalScore: payload.totalScore,
      maxScore: payload.maxScore,
      itemResults: payload.itemResults,
      serverReceipt: payload.serverReceipt,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, 'update', `attempts/${attemptId}`);
  }
}

export async function logViolationEvent(params: {
  attemptId: string;
  quizId: string;
  type: ViolationType;
  detail: string;
}): Promise<void> {
  const violationId = `vio_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await setDoc(doc(db, 'attempts', params.attemptId, 'violations', violationId), {
      attemptId: params.attemptId,
      quizId: params.quizId,
      type: params.type,
      detail: params.detail.slice(0, 500),
      clientTimestamp: new Date().toISOString(),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, 'create', `attempts/${params.attemptId}/violations/${violationId}`);
  }
}

export async function listAttemptsAdmin(quizId?: string): Promise<QuizAttempt[]> {
  try {
    const q = quizId
      ? query(
          collection(db, 'attempts'),
          where('quizId', '==', quizId),
          orderBy('updatedAt', 'desc')
        )
      : query(collection(db, 'attempts'), orderBy('updatedAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as QuizAttempt);
  } catch (error) {
    // Fallback if composite index hasn't been created yet for quizId + updatedAt
    if (quizId) {
      try {
        const simpleQ = query(collection(db, 'attempts'), where('quizId', '==', quizId));
        const snap = await getDocs(simpleQ);
        return snap.docs.map((d) => d.data() as QuizAttempt);
      } catch (innerError) {
        handleFirestoreError(innerError, 'list', 'attempts');
      }
    }
    handleFirestoreError(error, 'list', 'attempts');
  }
}

export async function saveManualEssayGradeAdmin(params: {
  attempt: QuizAttempt;
  manualScoresByQuestion: Record<string, number>;
  manualFeedback: Record<string, string>;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Admin belum login.');

  const updatedItemResults = { ...params.attempt.itemResults };
  let manualScore = 0;

  for (const [qId, item] of Object.entries(updatedItemResults)) {
    if (!item.isAutoGraded || qId in params.manualScoresByQuestion) {
      const assigned =
        qId in params.manualScoresByQuestion
          ? Math.max(0, Math.min(item.maxPoints, Number(params.manualScoresByQuestion[qId]) || 0))
          : item.earnedPoints;
      updatedItemResults[qId] = {
        ...item,
        earnedPoints: assigned,
        isCorrect: assigned >= item.maxPoints * 0.6,
        feedback: params.manualFeedback[qId] || item.feedback || '',
      };
    }
  }

  let recalculatedObjective = 0;
  for (const item of Object.values(updatedItemResults)) {
    if (item.isAutoGraded) recalculatedObjective += item.earnedPoints;
    else manualScore += item.earnedPoints;
  }
  const totalScore = Math.round((recalculatedObjective + manualScore) * 100) / 100;

  try {
    await updateDoc(doc(db, 'attempts', params.attempt.id), {
      status: 'graded',
      manualScore: Math.round(manualScore * 100) / 100,
      totalScore,
      itemResults: updatedItemResults,
      manualFeedback: params.manualFeedback,
      gradedByUid: user.uid,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, 'update', `attempts/${params.attempt.id}`);
  }
}

export async function deleteAttemptAdmin(attemptId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'attempts', attemptId));
  } catch (error) {
    handleFirestoreError(error, 'delete', `attempts/${attemptId}`);
  }
}

export async function seedMultimodalEnglishPack(): Promise<string> {
  const now = new Date();
  const startAt = new Date(now.getTime() - 3600 * 1000).toISOString();
  const endAt = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();
  const quizId = 'quiz_english_multimodal_x';

  const questions: FullQuestion[] = [
    {
      id: 'q_eng_1',
      number: 1,
      type: 'mcq',
      points: 15,
      stimulusText:
        'PUBLIC NOTICE — St. Jude Public Library & Gardens:\n• Reading Room & Quiet Zone are located to the right of the main path.\n• Eco Garden is located to the left of the main path.\n• Community Gardening Workshop takes place every Saturday at 11:00 AM.\n• Mobile phones must be switched to silent mode inside the Quiet Zone.',
      stimulusImageUrl: '/src/assets/images/english_multimodal_park_1794813404090.jpg',
      stimulusCaption: 'Library Courtyard & Eco Garden Directional Board',
      prompt:
        'Based on the directional board and notice text, which instruction applies to a visitor who wants to read quietly?',
      options: [
        { id: 'opt_A', label: 'A', text: 'Turn left toward the Eco Garden and attend the Saturday workshop.' },
        { id: 'opt_B', label: 'B', text: 'Follow the right-hand path and silence mobile phones before entering.' },
        { id: 'opt_C', label: 'C', text: 'Volunteer for garden maintenance before entering the Reading Room.' },
        { id: 'opt_D', label: 'D', text: 'Leave all printed books at the courtyard entrance.' },
      ],
      correctOptionId: 'opt_B',
    },
    {
      id: 'q_eng_2',
      number: 2,
      type: 'complex_mcq',
      points: 20,
      stimulusText:
        'AUDIO BRIEFING TRANSCRIPT / LISTENING PROMPT: "Welcome to our Digital Literacy Briefing. Before submitting your English multimodal project, make sure your slide narration lasts between two and three minutes, cite at least two credible sources on the final slide, and export your audio track in MP3 format."',
      prompt:
        'Which TWO requirements are explicitly stated in the briefing? (Select all that apply)',
      options: [
        { id: 'opt_A', label: 'A', text: 'Keep the slide narration between two and three minutes long.' },
        { id: 'opt_B', label: 'B', text: 'Submit a printed hardcopy transcript to the library.' },
        { id: 'opt_C', label: 'C', text: 'Cite at least two credible sources on the final slide.' },
        { id: 'opt_D', label: 'D', text: 'Record the presentation exclusively as a silent PDF.' },
      ],
      correctOptionIds: ['opt_A', 'opt_C'],
    },
    {
      id: 'q_eng_3',
      number: 3,
      type: 'grouping',
      points: 20,
      prompt:
        'Classify each English expression into the correct communicative function.',
      categories: [
        { id: 'cat_opinion', label: 'Asking for Opinion' },
        { id: 'cat_agree', label: 'Expressing Agreement' },
        { id: 'cat_disagree', label: 'Polite Disagreement' },
      ],
      items: [
        { id: 'itm_1', text: 'What is your perspective on using podcasts for listening practice?' },
        { id: 'itm_2', text: 'I completely share your viewpoint on that approach.' },
        { id: 'itm_3', text: 'I see your point, however the audio speed might overwhelm beginners.' },
        { id: 'itm_4', text: 'Could you share your thoughts on the visual diagram?' },
      ],
      correctMapping: {
        itm_1: 'cat_opinion',
        itm_2: 'cat_agree',
        itm_3: 'cat_disagree',
        itm_4: 'cat_opinion',
      },
    },
    {
      id: 'q_eng_4',
      number: 4,
      type: 'short_essay',
      points: 15,
      stimulusText:
        'Grammar in Context: Complete the announcement sentence using the correct passive voice structure.\n"The Eco Garden workshop ____ (host) by senior library volunteers every Saturday morning."',
      prompt:
        'Write the exact two-word present passive verb phrase to complete the sentence.',
      acceptedAnswers: ['is hosted'],
      caseSensitive: false,
    },
    {
      id: 'q_eng_5',
      number: 5,
      type: 'long_essay',
      points: 30,
      stimulusText:
        'Visual & Textual Synthesis: Look again at the Public Library & Gardens environment shown in Question 1. Many students prefer studying in a quiet indoor Reading Room, while others collaborate better in open green spaces like the Eco Garden.',
      prompt:
        'Write a coherent analytical paragraph (80-120 words) in English explaining which study zone suits you best and give two specific academic reasons to support your choice.',
      rubricNotes:
        'Penilaian: (10 poin) Klaim posisi jelas & relevan; (10 poin) Dua alasan konkret mendukung argumen; (10 poin) Tata bahasa, ejaan, dan kohesi kalimat Bahasa Inggris akurat.',
    },
  ];

  await saveQuizWithSealedKeys({
    quizId,
    title: 'Asesmen Bahasa Inggris Multimodal — Public Literacy & Academic Writing',
    subject: 'Bahasa Inggris',
    description:
      'Evaluasi komprehensif mencakup literasi teks visual, pemahaman instruksi, pengelompokan ungkapan komunikatif, tata bahasa kontekstual, dan menulis analitis.',
    instructions:
      '1. Pastikan Anda mengerjakan dalam mode layar penuh.\n2. Perhatikan teks bacaan dan gambar stimulus di panel kiri sebelum menjawab.\n3. Gunakan tombol "Tandai Ragu-ragu" untuk meninjau soal sebelum waktu habis.\n4. Dilarang menyalin teks, membuka tab lain, atau menggunakan pintasan inspeksi.',
    classTargets: ['X TJKT 1', 'X TJKT 2', 'X RPL 1', 'XI RPL 1'],
    status: 'published',
    startAt,
    endAt,
    durationMinutes: 45,
    shuffleQuestions: false,
    requireFullscreen: true,
    maxViolations: 5,
    fullQuestions: questions,
    isNew: false,
  });

  // Seed initial sample participants
  const sampleRoster = [
    { id: 'part_2026001', nis: '2026001', name: 'Aulia Rahmawati', className: 'X TJKT 1' },
    { id: 'part_2026002', nis: '2026002', name: 'Bagas Pratama', className: 'X TJKT 1' },
    { id: 'part_2026003', nis: '2026003', name: 'Citra Dewi Lestari', className: 'X RPL 1' },
  ];
  for (const p of sampleRoster) {
    await saveParticipantAdmin({ ...p, active: true, isNew: false });
  }

  return quizId;
}
