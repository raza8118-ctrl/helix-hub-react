// Learning paths by role, with completion tracking (roadmap 3.5).
// A path has Day 1…N with items: 'sop' (done when the person has acknowledged that SOP — from sop_reads),
// 'task' / 'link' (ticked by the person, or by a trainer when needs_trainer). No patient data (PHI) here.
import { db, S } from './supabase';
import { logAudit } from './audit';
import { today, addDays, isWknd } from './helpers';
import { loadQuizPasses, summarise } from './sopQuiz';

export const ITEM_KINDS = [
  { value: 'sop',  label: 'SOP',  icon: '📄', hint: 'Done when the person acknowledges the SOP' },
  { value: 'task', label: 'Task', icon: '✅', hint: 'e.g. Shadow a senior AR caller for 2 hours' },
  { value: 'link', label: 'Link', icon: '🔗', hint: 'An outside course or video' },
];
export const kindOf = value => ITEM_KINDS.find(k => k.value === value) ?? ITEM_KINDS[1];

const now = () => new Date().toISOString();
const bySort = (a, b) => a.day_no - b.day_no || (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id;

/**
 * Everything the Training page needs, or null when the 3.5 database update hasn't been run.
 * acks = SOP acknowledgements (sop_id + emp_id), empty if the 3.4 update isn't there.
 */
export async function loadTraining() {
  const [paths, items, assignments, progress, acks, sops, users, quizAttempts] = await Promise.all([
    db('learning_paths').select('*'),
    db('learning_path_items').select('*'),
    db('learning_assignments').select('*'),
    db('learning_progress').select('*').eq('active', true),
    db('sop_reads').select('sop_id,emp_id,acknowledged_at').not('acknowledged_at', 'is', null),
    db('sops').select('id,title,status,active'),
    db('users').select('emp_id,name,team,active'),
    loadQuizPasses(),
  ]);
  if ([paths, items, assignments, progress].some(r => r.error)) return null;
  return {
    paths: (paths.data ?? []).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    items: (items.data ?? []).sort(bySort),
    assignments: assignments.data ?? [],
    progress: progress.data ?? [],
    acks: acks.error ? [] : acks.data ?? [],
    sops: sops.error ? [] : sops.data ?? [],
    users: (users.data ?? []).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    quizAttempts: quizAttempts ?? [],   // 3.6: [{ sop_id, emp_id, score_pct, passed, taken_at }]
    quizReady: quizAttempts != null,    // the 3.6 update (quizzes + learning_path_items.needs_quiz) has been run
  };
}

/** First working day on or after a date (weekends skipped). */
export function workingDayFrom(date) {
  let d = date;
  while (isWknd(d)) d = addDays(d, 1);
  return d;
}

/** Due date of Day N: the start date (moved off a weekend), then one working day per later day. */
export function dueDateFor(startDate, dayNo) {
  let d = workingDayFrom(startDate);
  for (let i = 1; i < dayNo; i++) d = workingDayFrom(addDays(d, 1));
  return d;
}

/** Active items of a path in day order. */
export const pathItems = (data, pathId) => data.items.filter(i => i.path_id === pathId && i.active !== false);

/** Number of days a path shows: its setting, or more if items sit on later days. */
export const pathDays = (path, items) => Math.max(path.days ?? 1, ...items.map(i => i.day_no), 1);

/**
 * Status of one assignment: every item with done / due / overdue, plus totals.
 * Returns { items: [{ item, done, doneAt, doneBy, due, overdue, acked, quiz }], total, done, pct, currentDay, overdue, days, complete }.
 * SOP items with needs_quiz (3.6) are done only when acknowledged AND the quiz is passed; quiz = { best, attempts, passedAt }.
 */
export function assignmentStatus(data, assignment) {
  const path = data.paths.find(p => p.id === assignment.path_id);
  const items = pathItems(data, assignment.path_id);
  const ticks = Object.fromEntries(data.progress.filter(p => p.assignment_id === assignment.id).map(p => [p.item_id, p]));
  const day = today();
  const rows = items.map(item => {
    let doneAt = null, doneBy = null, acked = null, quiz = null;
    if (item.kind === 'sop') {
      const ack = data.acks.find(a => a.sop_id === item.sop_id && a.emp_id === assignment.emp_id);
      acked = ack?.acknowledged_at ?? null;
      quiz = summarise((data.quizAttempts ?? []).filter(a => a.sop_id === item.sop_id && a.emp_id === assignment.emp_id))[assignment.emp_id] ?? null;
      const quizOk = !item.needs_quiz || !!quiz?.passedAt;
      doneAt = acked && quizOk ? [acked, item.needs_quiz ? quiz.passedAt : null].filter(Boolean).sort().pop() : null;
      doneBy = doneAt ? assignment.emp_id : null;
    } else if (ticks[item.id]) {
      doneAt = ticks[item.id].done_at;
      doneBy = ticks[item.id].done_by;
    }
    const due = dueDateFor(assignment.start_date, item.day_no);
    return { item, done: !!doneAt, doneAt, doneBy, due, overdue: !doneAt && due < day, acked, quiz };
  });
  const done = rows.filter(r => r.done).length;
  const firstOpen = rows.find(r => !r.done);
  return {
    path, items: rows, total: rows.length, done,
    pct: rows.length ? Math.round((done / rows.length) * 100) : 0,
    currentDay: firstOpen ? firstOpen.item.day_no : null,
    overdue: rows.filter(r => r.overdue).length,
    days: path ? pathDays(path, items) : 1,
    complete: rows.length > 0 && done === rows.length,
  };
}

/** Display name of an item (SOP items use the SOP title unless a label was given). */
export function itemTitle(data, item) {
  if (item.kind === 'sop') return item.title || data.sops.find(s => s.id === item.sop_id)?.title || 'SOP (not found)';
  return item.title || '(no title)';
}

// ── Ticks ─────────────────────────────────────────────────────────────────

/** Ticks a task/link item. byTrainer = a trainer confirming it for someone. Returns true when saved. */
export async function tickItem(data, assignment, item, user, { byTrainer = false } = {}) {
  const rows = await S.set('learning_progress', { assignment_id: assignment.id, item_id: item.id, done_by: user.emp_id, active: true });
  if (!rows?.length) return false;
  logAudit({
    actor: user, action: byTrainer ? 'training_trainer_confirm' : 'training_item_done',
    targetEmpId: byTrainer ? assignment.emp_id : null, entityType: 'learning_assignment', entityId: assignment.id,
    details: { item_id: item.id },
  });
  await stampCompletion({ ...data, progress: [...data.progress, rows[0]] }, assignment, user);
  return true;
}

/** Undoes a mistaken tick (the record is kept, made inactive). */
export async function untickItem(data, assignment, item, user) {
  const tick = data.progress.find(p => p.assignment_id === assignment.id && p.item_id === item.id);
  if (!tick) return false;
  const ok = await S.update('learning_progress', { active: false }, { id: tick.id });
  if (!ok) return false;
  logAudit({ actor: user, action: 'training_item_undo', entityType: 'learning_assignment', entityId: assignment.id, details: { item_id: item.id } });
  return true;
}

/** Records the completion date the first time every item is done. */
export async function stampCompletion(data, assignment, user) {
  if (assignment.completed_at) return;
  if (!assignmentStatus(data, assignment).complete) return;
  const ok = await S.update('learning_assignments', { completed_at: now() }, { id: assignment.id });
  if (ok) logAudit({ actor: user, action: 'training_path_complete', targetEmpId: assignment.emp_id, entityType: 'learning_assignment', entityId: assignment.id });
}

// ── Paths and items ───────────────────────────────────────────────────────

/** Adds or edits a path. Returns the saved row, or null. */
export async function savePath(path, values, user) {
  const payload = { ...values, updated_by: user.emp_id, updated_at: now() };
  const rows = path
    ? await S.update('learning_paths', payload, { id: path.id })
    : await S.set('learning_paths', { ...payload, active: true, created_by: user.emp_id });
  if (!rows?.length) return null;
  logAudit({ actor: user, action: path ? 'training_path_edit' : 'training_path_add', entityType: 'learning_path', entityId: rows[0].id });
  return rows[0];
}

/** Copies a path and its active items as a new path. */
export async function copyPath(data, path, user) {
  const copy = await savePath(null, {
    name: `${path.name} (copy)`, description: path.description, team: path.team, days: path.days,
  }, user);
  if (!copy) return null;
  const items = pathItems(data, path.id).map(i => ({
    path_id: copy.id, day_no: i.day_no, sort_order: i.sort_order, kind: i.kind, sop_id: i.sop_id, title: i.title,
    url: i.url, needs_trainer: i.needs_trainer, active: true, created_by: user.emp_id, updated_by: user.emp_id,
    ...(data.quizReady ? { needs_quiz: !!i.needs_quiz } : {}),
  }));
  if (items.length) await S.set('learning_path_items', items);
  return copy;
}

export async function setPathActive(path, active, user) {
  const ok = await S.update('learning_paths', { active, updated_by: user.emp_id, updated_at: now() }, { id: path.id });
  if (ok) logAudit({ actor: user, action: active ? 'training_path_activate' : 'training_path_deactivate', entityType: 'learning_path', entityId: path.id });
  return !!ok;
}

/** Adds or edits an item. New items go to the end of their day. */
export async function saveItem(data, item, values, user) {
  const payload = { ...values, updated_by: user.emp_id, updated_at: now() };
  if (!item || item.day_no !== values.day_no) {
    const sameDay = pathItems(data, values.path_id).filter(i => i.day_no === values.day_no && i.id !== item?.id);
    payload.sort_order = Math.max(0, ...sameDay.map(i => i.sort_order ?? 0)) + 1;
  }
  const rows = item
    ? await S.update('learning_path_items', payload, { id: item.id })
    : await S.set('learning_path_items', { ...payload, active: true, created_by: user.emp_id });
  if (!rows?.length) return null;
  logAudit({ actor: user, action: item ? 'training_item_edit' : 'training_item_add', entityType: 'learning_path', entityId: values.path_id });
  return rows[0];
}

/** Moves an item up (-1) or down (+1) within its day; renumbers that day. */
export async function moveItem(dayItems, index, dir) {
  const target = index + dir;
  if (target < 0 || target >= dayItems.length) return false;
  const order = [...dayItems];
  [order[index], order[target]] = [order[target], order[index]];
  await Promise.all(order.map((it, i) => it.sort_order === i + 1 ? null
    : S.update('learning_path_items', { sort_order: i + 1 }, { id: it.id })));
  return true;
}

// ── Assignments ───────────────────────────────────────────────────────────

/**
 * Gives a path to people from a start date. Someone who already has it keeps their progress;
 * only their start date changes. Returns the number of people saved.
 */
export async function assignPath(data, path, empIds, startDate, user) {
  let saved = 0;
  for (const empId of empIds) {
    const existing = data.assignments.find(a => a.path_id === path.id && a.emp_id === empId && a.active !== false);
    const ok = existing
      ? await S.update('learning_assignments', { start_date: startDate }, { id: existing.id })
      : await S.set('learning_assignments', { path_id: path.id, emp_id: empId, start_date: startDate, assigned_by: user.emp_id, active: true });
    if (ok) {
      saved++;
      logAudit({ actor: user, action: 'training_assign', targetEmpId: empId, entityType: 'learning_path', entityId: path.id, details: { start_date: startDate } });
    }
  }
  return saved;
}

/** Takes a path away from someone (kept as inactive, with its progress). */
export async function unassign(assignment, user) {
  const ok = await S.update('learning_assignments', { active: false }, { id: assignment.id });
  if (ok) logAudit({ actor: user, action: 'training_unassign', targetEmpId: assignment.emp_id, entityType: 'learning_assignment', entityId: assignment.id });
  return !!ok;
}
