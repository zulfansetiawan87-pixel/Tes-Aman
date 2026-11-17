/**
 * Security Rules Verification Suite (Dirty Dozen Adversarial Payloads)
 * Designed for @firebase/rules-unit-testing against Firestore Emulator.
 */
import assert from 'node:assert/strict';

export const DIRTY_DOZEN_CASES = [
  {
    id: 1,
    name: 'Unverified Admin Email Spoof on /quizKeys',
    auth: { uid: 'spoof-uid', email: 'zulfansetiawan87@guru.smk.belajar.id', email_verified: false },
    operation: 'GET /quizKeys/quiz-1',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Non-Admin Reading Answer Keys',
    auth: { uid: 'student-uid', email: 'student@school.id', email_verified: true },
    operation: 'GET /quizKeys/quiz-1',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Unauthenticated Student Listing Attempts (PII Scraping)',
    auth: null,
    operation: 'LIST /attempts',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow Field Injection on Attempt Create',
    auth: null,
    operation: 'CREATE /attempts/att_0123456789abcdef01234567',
    payload: { isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Pre-Graded Attempt Creation',
    auth: null,
    operation: 'CREATE /attempts/att_0123456789abcdef01234567',
    payload: { status: 'submitted', totalScore: 100 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Post-Submission Score Tampering (Terminal Lock Bypass)',
    auth: null,
    operation: 'UPDATE /attempts/att_submitted_0123456789abcdef',
    payload: { totalScore: 100 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Immutable Identity Field Tampering',
    auth: null,
    operation: 'UPDATE /attempts/att_active_0123456789abcdef',
    payload: { nis: '999999', quizId: 'other-quiz' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Violation Log Forgery After Submission',
    auth: null,
    operation: 'CREATE /attempts/att_submitted_0123456789abcdef/violations/v-1',
    payload: { type: 'tab_switch' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'ID Poisoning / Denial of Wallet (>128 chars)',
    auth: null,
    operation: `CREATE /attempts/${'a'.repeat(200)}`,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Self-Privilege Escalation to super_admin',
    auth: { uid: 'attacker', email: 'attacker@school.id', email_verified: true },
    operation: 'CREATE /admins/attacker',
    payload: { uid: 'attacker', role: 'super_admin' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Draft Quiz Enumeration',
    auth: null,
    operation: 'GET /quizzes/draft-quiz-1',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Client Timestamp Forgery on Attempt Create',
    auth: null,
    operation: 'CREATE /attempts/att_0123456789abcdef01234567',
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
];

assert.equal(DIRTY_DOZEN_CASES.length, 12);
