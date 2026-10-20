// Quizzes per SOP with scores (roadmap 3.6). Scoring runs in the browser.
// One quiz per SOP; every attempt keeps a copy of the questions it was scored against.
import { db, S } from './supabase';
import { logAudit } from './audit';

export const DEFAULT_PASS_PCT = 80;
export const MIN_QUESTIONS = 1;
export const MAX_QUESTIONS = 10;
export const RECOMMENDED = { min: 3, max: 5 };
export const TRUE_FALSE = ['True', 'False'];

const now = () => new Date().toISOString();
export const newQuestionId = () => `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The quiz of an SOP (or null), or undefined when the 3.6 database update hasn't been run. */
export async function loadSopQuiz(sopId) {
  const { data, error } = await db('sop_quizzes').select('*').eq('sop_id', sopId);
  if (error) return undefined;
  return data?.[0] ?? null;
}

/** This user's attempts at an SOP's quiz, newest first. */
export async function loadMyAttempts(sopId, empId) {
  const { data, error } = await db('sop_quiz_attempts').select('*').eq('sop_id', sopId).eq('emp_id', empId);
  if (error) return [];
  return (data ?? []).sort((a, b) => b.taken_at.localeCompare(a.taken_at));
}

/** Best result per person for one SOP: { [emp_id]: { best, attempts, passedAt } }. */
export async function loadQuizSummary(sopId) {
  const { data, error } = await db('sop_quiz_attempts').select('emp_id,score_pct,passed,taken_at').eq('sop_id', sopId);
  if (error) return null;
  return summarise(data ?? []);
}

/** All attempts (sop_id + emp_id + score + date) — used by learning paths. null if quizzes aren't set up. */
export async function loadQuizPasses() {
  const { data, error } = await db('sop_quiz_attempts').select('sop_id,emp_id,score_pct,passed,taken_at');
  if (error) return null;
  return data ?? [];
}

/** Groups attempts by person: best score, number of attempts, first pass date. */
export function summarise(attempts) {
  const out = {};
  for (const a of attempts) {
    const s = (out[a.emp_id] ??= { best: 0, attempts: 0, passedAt: null });
    s.best = Math.max(s.best, a.score_pct);
    s.attempts++;
    if (a.passed && (!s.passedAt || a.taken_at < s.passedAt)) s.passedAt = a.taken_at;
  }
  return out;
}

/** Plain-English problems with a quiz draft (empty list = ok to save). */
export function checkQuiz(questions, passPct) {
  const problems = [];
  if (questions.length < MIN_QUESTIONS) problems.push('Add at least one question.');
  if (questions.length > MAX_QUESTIONS) problems.push(`A quiz can have up to ${MAX_QUESTIONS} questions.`);
  if (!(passPct >= 1 && passPct <= 100)) problems.push('The pass mark must be between 1 and 100%.');
  questions.forEach((q, i) => {
    const n = i + 1;
    if (!q.text.trim()) problems.push(`Question ${n} has no text.`);
    if (q.type === 'choice') {
      const filled = q.options.filter(o => o.trim());
      if (filled.length < 2) problems.push(`Question ${n} needs at least 2 answers.`);
      if (q.options.some(o => !o.trim())) problems.push(`Question ${n} has an empty answer — fill it in or remove it.`);
    }
    if (q.correct == null || q.correct < 0 || q.correct >= q.options.length) problems.push(`Question ${n}: tick the right answer.`);
  });
  return problems;
}

/** Saves (creates or updates) the quiz of an SOP. Returns the row, or null. */
export async function saveSopQuiz(quiz, sopId, { questions, passPct, active }, user) {
  const payload = { questions, pass_pct: passPct, active, updated_by: user.emp_id, updated_at: now() };
  const rows = quiz
    ? await S.update('sop_quizzes', payload, { id: quiz.id })
    : await S.set('sop_quizzes', { ...payload, sop_id: sopId, created_by: user.emp_id });
  if (!rows?.length) return null;
  logAudit({ actor: user, action: 'sop_quiz_edit', entityType: 'sop', entityId: sopId, details: { questions: questions.length, active } });
  return rows[0];
}

/** Fisher–Yates shuffle of option positions, e.g. [2, 0, 1]. */
export function shuffledOrder(n) {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Scores answers (original option index per question). Returns { correct, total, scorePct, passed, results }. */
export function scoreQuiz(quiz, answers) {
  const results = quiz.questions.map((q, i) => answers[i] === q.correct);
  const correct = results.filter(Boolean).length;
  const total = quiz.questions.length;
  const scorePct = total ? Math.round((correct / total) * 100) : 0;
  return { correct, total, scorePct, passed: scorePct >= (quiz.pass_pct ?? DEFAULT_PASS_PCT), results };
}

/** Records an attempt. Returns the saved row, or null. */
export async function saveAttempt(quiz, answers, score, user) {
  const rows = await S.set('sop_quiz_attempts', {
    quiz_id: quiz.id, sop_id: quiz.sop_id, emp_id: user.emp_id,
    correct: score.correct, total: score.total, score_pct: score.scorePct, passed: score.passed,
    answers, questions: quiz.questions,
  });
  if (!rows?.length) return null;
  logAudit({
    actor: user, action: 'sop_quiz_attempt', entityType: 'sop', entityId: quiz.sop_id,
    details: { score_pct: score.scorePct, passed: score.passed },
  });
  return rows[0];
}
