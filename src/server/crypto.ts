import crypto from 'node:crypto';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

function deriveKey(purpose: string, envVarName: string): Buffer {
  const configured = process.env[envVarName];
  if (configured && configured.length >= 16) {
    return crypto.createHash('sha256').update(`${purpose}:${configured}`).digest();
  }
  // Deterministic fallback bound to the provisioned Firebase project & database ID
  // so sealed key-packs survive server restarts in managed previews.
  const seed = `${purpose}:${firebaseConfig.projectId}:${firebaseConfig.firestoreDatabaseId}:${firebaseConfig.appId}`;
  return crypto.createHash('sha256').update(seed).digest();
}

const SEAL_KEY = deriveKey('quiz-seal-v1', 'QUIZ_SEAL_SECRET');
const SESSION_KEY = deriveKey('student-session-v1', 'SESSION_SECRET');
const RECEIPT_KEY = deriveKey('grading-receipt-v1', 'QUIZ_SEAL_SECRET');

export function encryptKeyPack(payload: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SEAL_KEY, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptKeyPack<T>(sealed: string): T {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Format sealedKeyPack tidak valid');
  }
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ciphertext = Buffer.from(parts[3], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', SEAL_KEY, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}

export interface StudentSessionPayload {
  attemptId: string;
  quizId: string;
  studentName: string;
  nis: string;
  className: string;
  startedAtMs: number;
  expiresAtMs: number;
  sessionNonce: string;
}

export function signStudentSession(payload: StudentSessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_KEY).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyStudentSession(token: string): StudentSessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_KEY).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StudentSessionPayload;
  } catch {
    return null;
  }
}

export interface ReceiptData {
  attemptId: string;
  quizId: string;
  nis: string;
  className: string;
  startedAt: string;
  submittedAt: string;
  objectiveScore: number;
  maxObjectiveScore: number;
  maxScore: number;
  sessionNonce: string;
}

export function signGradingReceipt(data: ReceiptData): string {
  const canonical = [
    data.attemptId,
    data.quizId,
    data.nis,
    data.className,
    data.startedAt,
    data.submittedAt,
    String(data.objectiveScore),
    String(data.maxObjectiveScore),
    String(data.maxScore),
    data.sessionNonce,
  ].join('|');
  return crypto.createHmac('sha256', RECEIPT_KEY).update(canonical).digest('hex');
}

export function verifyGradingReceipt(data: ReceiptData, receipt: string): boolean {
  if (!receipt || typeof receipt !== 'string') return false;
  const expected = signGradingReceipt(data);
  const a = Buffer.from(receipt, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
