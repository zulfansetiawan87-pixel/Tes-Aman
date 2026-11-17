export type QuestionType =
  | 'mcq'
  | 'complex_mcq'
  | 'grouping'
  | 'short_essay'
  | 'long_essay';

export interface QuestionOption {
  id: string;
  label: string;
  text: string;
}

export interface GroupingCategory {
  id: string;
  label: string;
}

export interface GroupingItem {
  id: string;
  text: string;
}

export interface PublicQuestion {
  id: string;
  number: number;
  type: QuestionType;
  prompt: string;
  stimulusText?: string;
  stimulusImageUrl?: string;
  stimulusAudioUrl?: string;
  stimulusCaption?: string;
  audioPlayLimit?: number;
  options?: QuestionOption[];
  categories?: GroupingCategory[];
  items?: GroupingItem[];
  points: number;
  caseSensitive?: boolean;
}

export interface QuestionKey {
  questionId: string;
  type: QuestionType;
  points: number;
  correctOptionId?: string;
  correctOptionIds?: string[];
  correctMapping?: Record<string, string>;
  acceptedAnswers?: string[];
  rubricKeywords?: string[];
  rubricNotes?: string;
}

export interface FullQuestion extends PublicQuestion {
  correctOptionId?: string;
  correctOptionIds?: string[];
  correctMapping?: Record<string, string>;
  acceptedAnswers?: string[];
  rubricKeywords?: string[];
  rubricNotes?: string;
}

export type QuizStatus = 'draft' | 'published' | 'archived';

export interface QuizDocument {
  id: string;
  title: string;
  subject: string;
  description?: string;
  instructions?: string;
  classTargets: string[];
  status: QuizStatus;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  shuffleQuestions: boolean;
  requireFullscreen: boolean;
  maxViolations: number;
  questions: PublicQuestion[];
  totalMaxScore: number;
  questionCount: number;
  sealedKeyPack: string;
  createdByUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface QuizKeyBundle {
  quizId: string;
  keys: QuestionKey[];
  updatedByUid: string;
  updatedAt?: unknown;
}

export interface QuestionBankItem {
  id: string;
  subject: string;
  type: QuestionType;
  tags: string[];
  questionData: FullQuestion;
  createdByUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ParticipantRecord {
  id: string;
  nis: string;
  name: string;
  className: string;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type ViolationType =
  | 'fullscreen_exit'
  | 'tab_switch'
  | 'window_blur'
  | 'copy_attempt'
  | 'paste_attempt'
  | 'context_menu'
  | 'shortcut_blocked'
  | 'resize_split_warning';

export interface ViolationSummaryEntry {
  type: ViolationType;
  detail: string;
  timestamp: string;
}

export type StudentAnswerValue =
  | string
  | string[]
  | Record<string, string>;

export interface ItemResult {
  questionId: string;
  type: QuestionType;
  maxPoints: number;
  earnedPoints: number;
  isAutoGraded: boolean;
  isCorrect: boolean | null;
  feedback?: string;
}

export type AttemptStatus = 'in_progress' | 'submitted' | 'graded';

export interface QuizAttempt {
  id: string;
  quizId: string;
  quizTitle: string;
  studentName: string;
  nis: string;
  className: string;
  status: AttemptStatus;
  startedAt: string;
  expiresAt: string;
  submittedAt?: string;
  autoSubmitted: boolean;
  answers: Record<string, StudentAnswerValue>;
  flaggedQuestions: string[];
  currentQuestionIndex: number;
  violationCount: number;
  violationsSummary: ViolationSummaryEntry[];
  objectiveScore: number;
  maxObjectiveScore: number;
  manualScore: number;
  maxManualScore: number;
  totalScore: number;
  maxScore: number;
  itemResults: Record<string, ItemResult>;
  manualFeedback: Record<string, string>;
  serverReceipt: string;
  sessionNonce: string;
  gradedByUid?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ParsedImportQuestion {
  tempId: string;
  type: QuestionType;
  prompt: string;
  stimulusText: string;
  stimulusImageUrl: string;
  stimulusAudioUrl: string;
  stimulusCaption: string;
  options: QuestionOption[];
  categories: GroupingCategory[];
  items: GroupingItem[];
  points: number;
  correctOptionId: string;
  correctOptionIds: string[];
  correctMapping: Record<string, string>;
  acceptedAnswers: string[];
  rubricNotes: string;
  warnings: string[];
  confidence: 'high' | 'medium' | 'low';
}
