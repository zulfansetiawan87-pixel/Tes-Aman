import assert from 'node:assert/strict';
import {
  decryptKeyPack,
  encryptKeyPack,
  signGradingReceipt,
  signStudentSession,
  verifyGradingReceipt,
  verifyStudentSession,
} from '../src/server/crypto.ts';
import { generateQuizImportTemplateDocx } from '../src/server/docxTemplate.ts';
import { gradeSubmissionOnServer } from '../src/server/grading.ts';
import {
  extractTextFromUploadedDocument,
  parseQuestionsFromText,
} from '../src/server/importParser.ts';
import type { QuestionKey } from '../src/types/quiz.ts';

async function runTests() {
  // 1. Test AES-256-GCM sealing & unsealing
  const sampleKeys: QuestionKey[] = [
    { questionId: 'q1', type: 'mcq', points: 10, correctOptionId: 'opt_B' },
    { questionId: 'q2', type: 'complex_mcq', points: 20, correctOptionIds: ['opt_A', 'opt_C'] },
    {
      questionId: 'q3',
      type: 'grouping',
      points: 20,
      correctMapping: { i1: 'c1', i2: 'c2' },
    },
    {
      questionId: 'q4',
      type: 'short_essay',
      points: 10,
      acceptedAnswers: ['will be organized', 'will be organised'],
    },
    { questionId: 'q5', type: 'long_essay', points: 40, rubricNotes: 'Check coherence' },
  ];

  const sealed = encryptKeyPack({ quizId: 'quiz_1', keys: sampleKeys });
  assert.ok(sealed.startsWith('v1.'));
  const unsealed = decryptKeyPack<{ quizId: string; keys: QuestionKey[] }>(sealed);
  assert.equal(unsealed.quizId, 'quiz_1');
  assert.equal(unsealed.keys.length, 5);

  // 2. Test server-side grading across all 5 types
  const grading = gradeSubmissionOnServer(sampleKeys, {
    q1: 'opt_B', // 10/10
    q2: ['opt_A', 'opt_C'], // 20/20
    q3: { i1: 'c1', i2: 'c1' }, // 10/20 partial
    q4: '  Will Be   Organized ', // 10/10 normalized
    q5: 'Student long analytical paragraph...', // 0 manual
  });

  assert.equal(grading.objectiveScore, 50);
  assert.equal(grading.maxObjectiveScore, 60);
  assert.equal(grading.maxManualScore, 40);
  assert.equal(grading.maxScore, 100);

  // 3. Test HMAC session token & tamper rejection
  const token = signStudentSession({
    attemptId: 'att_123',
    quizId: 'quiz_1',
    studentName: 'Aulia',
    nis: '2026001',
    className: 'X TJKT 1',
    startedAtMs: 1000,
    expiresAtMs: 2000,
    sessionNonce: 'nonce_abc',
  });
  const verified = verifyStudentSession(token);
  assert.ok(verified);
  assert.equal(verified?.nis, '2026001');
  assert.equal(verifyStudentSession(`${token}tampered`), null);

  // 4. Test grading receipt signature
  const receiptData = {
    attemptId: 'att_123',
    quizId: 'quiz_1',
    nis: '2026001',
    className: 'X TJKT 1',
    startedAt: '2026-11-15T10:00:00.000Z',
    submittedAt: '2026-11-15T10:30:00.000Z',
    objectiveScore: 50,
    maxObjectiveScore: 60,
    maxScore: 100,
    sessionNonce: 'nonce_abc',
  };
  const receipt = signGradingReceipt(receiptData);
  assert.equal(verifyGradingReceipt(receiptData, receipt), true);
  assert.equal(
    verifyGradingReceipt({ ...receiptData, objectiveScore: 60 }, receipt),
    false
  );

  // 5. Test DOCX template generation + mammoth extraction + parser roundtrip
  const docxBuf = await generateQuizImportTemplateDocx();
  assert.ok(docxBuf.length > 2000);
  const extractedText = await extractTextFromUploadedDocument(
    docxBuf,
    'template.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  const parsedQuestions = parseQuestionsFromText(extractedText);
  assert.equal(parsedQuestions.length, 5);
  assert.equal(parsedQuestions[0].type, 'mcq');
  assert.equal(parsedQuestions[1].type, 'complex_mcq');
  assert.equal(parsedQuestions[2].type, 'grouping');
  assert.equal(parsedQuestions[3].type, 'short_essay');
  assert.equal(parsedQuestions[4].type, 'long_essay');

  console.log('ALL SERVER TESTS PASSED (5/5 suites)');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
