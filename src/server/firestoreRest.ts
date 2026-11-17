import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import type { QuizDocument } from '../types/quiz.ts';

interface FirestoreValue {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  timestampValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
}

function decodeFirestoreValue(val: FirestoreValue): unknown {
  if ('stringValue' in val && val.stringValue !== undefined) return val.stringValue;
  if ('integerValue' in val && val.integerValue !== undefined) return Number(val.integerValue);
  if ('doubleValue' in val && val.doubleValue !== undefined) return Number(val.doubleValue);
  if ('booleanValue' in val && val.booleanValue !== undefined) return val.booleanValue;
  if ('timestampValue' in val && val.timestampValue !== undefined) return val.timestampValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val && val.arrayValue) {
    return (val.arrayValue.values || []).map((item) => decodeFirestoreValue(item));
  }
  if ('mapValue' in val && val.mapValue) {
    const out: Record<string, unknown> = {};
    const fields = val.mapValue.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return null;
}

export async function fetchPublishedQuizFromFirestore(quizId: string): Promise<QuizDocument | null> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(quizId)) {
    return null;
  }

  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    firebaseConfig.projectId
  )}/databases/${encodeURIComponent(
    firebaseConfig.firestoreDatabaseId
  )}/documents/quizzes/${encodeURIComponent(quizId)}?key=${encodeURIComponent(
    firebaseConfig.apiKey
  )}`;

  const res = await fetch(url);
  if (res.status === 404 || res.status === 403) {
    return null;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firestore REST error (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { fields?: Record<string, FirestoreValue> };
  if (!json.fields) return null;

  const decoded: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(json.fields)) {
    decoded[k] = decodeFirestoreValue(v);
  }
  return decoded as unknown as QuizDocument;
}
