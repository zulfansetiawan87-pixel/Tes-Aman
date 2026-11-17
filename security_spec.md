# Security Specification — SECURE QUIZ

## 1. Data Invariants
1. **Zero Answer-Key Exposure**: Plaintext answer keys (`/quizKeys/{quizId}`) are strictly readable and writable only by verified admins (`isAdmin()`). Student-readable `/quizzes/{quizId}` documents contain only sanitized questions plus an AES-256-GCM encrypted `sealedKeyPack` created by the backend.
2. **Verified Admin Identity**: `isAdmin()` requires `request.auth != null`, `request.auth.token.email_verified == true`, and either the bootstrapped super-admin email or a verified `/admins/{uid}` document.
3. **Attempt Ownership & Terminal State Locking**: Students can only create an `/attempts/{attemptId}` document when `status == 'in_progress'` for an existing `published` quiz, and cannot mutate `quizId`, `nis`, `studentName`, `className`, `createdAt`, or `sessionNonce`. Once `status` becomes `'submitted'` or `'graded'`, non-admin updates are strictly rejected.
4. **No PII Enumeration**: `allow list` on `/attempts`, `/attempts/{attemptId}/violations`, `/participants`, `/admins`, and `/quizKeys` is restricted to `isAdmin()`.
5. **Immutable Violation Audit Log**: Proctoring violations under `/attempts/{attemptId}/violations/{violationId}` can only be created while the parent attempt is `'in_progress'`, and cannot be updated or deleted by students.
6. **Temporal & Schema Boundaries**: Every string and list has explicit `.size()` limits, every ID matches `^[a-zA-Z0-9_\-]+$`, and `createdAt`/`updatedAt` timestamps must match `request.time`.

## 2. The "Dirty Dozen" Attack Payloads (Must Return PERMISSION_DENIED)
1. **Unverified Admin Email Spoof**: User with `email: 'zulfansetiawan87@guru.smk.belajar.id'` and `email_verified: false` tries to read `/quizKeys/quiz-1`.
2. **Non-Admin Reading Answer Keys**: Authenticated regular user tries to `get` or `list` `/quizKeys/quiz-1`.
3. **Student Listing All Attempts (PII Scraping)**: Unauthenticated or non-admin client tries `list` on `/attempts`.
4. **Shadow Field Injection on Attempt Create**: Student attempts to create `/attempts/att-1` with extra field `isAdmin: true`.
5. **Pre-Graded Attempt Creation**: Student attempts to create `/attempts/att-1` directly with `status: 'submitted'` and `totalScore: 100`.
6. **Post-Submission Score Tampering (Terminal Lock Bypass)**: Student tries to update `/attempts/att-1` where existing `status == 'submitted'` to change `totalScore` or `objectiveScore`.
7. **Immutable Identity Field Tampering**: Student updates an active attempt trying to alter `nis`, `quizId`, or `createdAt`.
8. **Violation Log Forgery After Submission**: Client tries to create a violation under `/attempts/att-1/violations/v-1` after `att-1` is already `'submitted'`.
9. **ID Poisoning / Denial of Wallet**: Client tries to create `/attempts/<2000-char-id>` or inject a `detail` string > 500 chars into a violation.
10. **Self-Privilege Escalation**: Non-admin authenticated user tries to write `/admins/{theirUid}` with `role: 'super_admin'`.
11. **Draft Quiz Enumeration**: Unauthenticated student tries to read `/quizzes/draft-quiz-1` where `status == 'draft'`.
12. **Client Timestamp Forgery**: Client creates `/attempts/att-1` with a backdated `createdAt` instead of `request.time`.
