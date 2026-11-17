import type {
  ItemResult,
  QuestionKey,
  StudentAnswerValue,
} from '../types/quiz.ts';

function normalizeText(value: string, caseSensitive: boolean): string {
  const collapsed = value.trim().replace(/\s+/g, ' ');
  return caseSensitive ? collapsed : collapsed.toLowerCase();
}

export interface ServerGradingOutput {
  objectiveScore: number;
  maxObjectiveScore: number;
  maxManualScore: number;
  maxScore: number;
  itemResults: Record<string, ItemResult>;
}

export function gradeSubmissionOnServer(
  keys: QuestionKey[],
  answers: Record<string, StudentAnswerValue>,
  caseSensitivityMap: Record<string, boolean> = {}
): ServerGradingOutput {
  let objectiveScore = 0;
  let maxObjectiveScore = 0;
  let maxManualScore = 0;
  let maxScore = 0;
  const itemResults: Record<string, ItemResult> = {};

  for (const key of keys) {
    const pts = Number(key.points) || 0;
    maxScore += pts;
    const rawAns = answers[key.questionId];

    if (key.type === 'mcq') {
      maxObjectiveScore += pts;
      const selected = typeof rawAns === 'string' ? rawAns : '';
      const correct = selected !== '' && selected === (key.correctOptionId || '');
      const earned = correct ? pts : 0;
      objectiveScore += earned;
      itemResults[key.questionId] = {
        questionId: key.questionId,
        type: key.type,
        maxPoints: pts,
        earnedPoints: earned,
        isAutoGraded: true,
        isCorrect: correct,
      };
    } else if (key.type === 'complex_mcq') {
      maxObjectiveScore += pts;
      const selectedArr = Array.isArray(rawAns)
        ? Array.from(new Set(rawAns.map((v) => String(v))))
        : [];
      const expectedArr = Array.from(new Set(key.correctOptionIds || []));

      if (expectedArr.length === 0) {
        itemResults[key.questionId] = {
          questionId: key.questionId,
          type: key.type,
          maxPoints: pts,
          earnedPoints: 0,
          isAutoGraded: true,
          isCorrect: false,
        };
        continue;
      }

      const expectedSet = new Set(expectedArr);
      let truePositives = 0;
      let falsePositives = 0;
      for (const s of selectedArr) {
        if (expectedSet.has(s)) truePositives++;
        else falsePositives++;
      }

      // Proportional credit with penalty for wrong picks, clamped [0, pts]
      const rawRatio = Math.max(0, (truePositives - falsePositives) / expectedArr.length);
      const earned = Math.round(pts * rawRatio * 100) / 100;
      const exact = truePositives === expectedArr.length && falsePositives === 0;
      objectiveScore += earned;

      itemResults[key.questionId] = {
        questionId: key.questionId,
        type: key.type,
        maxPoints: pts,
        earnedPoints: earned,
        isAutoGraded: true,
        isCorrect: exact,
      };
    } else if (key.type === 'grouping') {
      maxObjectiveScore += pts;
      const studentMap =
        rawAns && typeof rawAns === 'object' && !Array.isArray(rawAns)
          ? (rawAns as Record<string, string>)
          : {};
      const expectedMap = key.correctMapping || {};
      const itemIds = Object.keys(expectedMap);
      if (itemIds.length === 0) {
        itemResults[key.questionId] = {
          questionId: key.questionId,
          type: key.type,
          maxPoints: pts,
          earnedPoints: 0,
          isAutoGraded: true,
          isCorrect: false,
        };
        continue;
      }

      let matched = 0;
      for (const itemId of itemIds) {
        if (studentMap[itemId] && studentMap[itemId] === expectedMap[itemId]) {
          matched++;
        }
      }
      const earned = Math.round((pts * (matched / itemIds.length)) * 100) / 100;
      const exact = matched === itemIds.length;
      objectiveScore += earned;

      itemResults[key.questionId] = {
        questionId: key.questionId,
        type: key.type,
        maxPoints: pts,
        earnedPoints: earned,
        isAutoGraded: true,
        isCorrect: exact,
      };
    } else if (key.type === 'short_essay') {
      maxObjectiveScore += pts;
      const studentText = typeof rawAns === 'string' ? rawAns : '';
      const isCaseSensitive = Boolean(caseSensitivityMap[key.questionId]);
      const normStudent = normalizeText(studentText, isCaseSensitive);
      const accepted = (key.acceptedAnswers || [])
        .map((a) => normalizeText(a, isCaseSensitive))
        .filter((a) => a.length > 0);
      const correct = normStudent.length > 0 && accepted.includes(normStudent);
      const earned = correct ? pts : 0;
      objectiveScore += earned;

      itemResults[key.questionId] = {
        questionId: key.questionId,
        type: key.type,
        maxPoints: pts,
        earnedPoints: earned,
        isAutoGraded: true,
        isCorrect: correct,
      };
    } else {
      // long_essay requires manual teacher evaluation
      maxManualScore += pts;
      itemResults[key.questionId] = {
        questionId: key.questionId,
        type: key.type,
        maxPoints: pts,
        earnedPoints: 0,
        isAutoGraded: false,
        isCorrect: null,
      };
    }
  }

  return {
    objectiveScore: Math.round(objectiveScore * 100) / 100,
    maxObjectiveScore: Math.round(maxObjectiveScore * 100) / 100,
    maxManualScore: Math.round(maxManualScore * 100) / 100,
    maxScore: Math.round(maxScore * 100) / 100,
    itemResults,
  };
}
