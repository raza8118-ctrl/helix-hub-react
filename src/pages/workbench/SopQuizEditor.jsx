import { useState } from 'react';
import {
  DEFAULT_PASS_PCT, MAX_QUESTIONS, RECOMMENDED, TRUE_FALSE, newQuestionId, checkQuiz, saveSopQuiz,
} from '../../lib/sopQuiz';
import Modal from '../../components/shared/Modal';
import { confirmDialog } from '../../components/shared/Dialog';

const MAX_OPTIONS = 5;
const blankQuestion = () => ({ id: newQuestionId(), text: '', type: 'choice', options: ['', ''], correct: null, why: '' });

/**
 * Add / edit the quiz of an SOP (roadmap 3.6): multiple choice (2–5 answers, one right) or True/False,
 * optional "Why" explanation, pass mark, reorder, switch off. Earlier attempts keep their own copy of the questions.
 */
export default function SopQuizEditor({ sop, quiz, user, onClose, onSaved }) {
  const [questions, setQuestions] = useState(() => quiz?.questions?.length
    ? quiz.questions.map(q => ({ ...q, why: q.why ?? '' }))
    : [blankQuestion(), blankQuestion(), blankQuestion()]);
  const [passPct, setPassPct] = useState(quiz?.pass_pct ?? DEFAULT_PASS_PCT);
  const [active, setActive] = useState(quiz?.active ?? true);
  const [problems, setProblems] = useState([]);
  const [saving, setSaving] = useState(false);

  const setQ = (i, patch) => { setQuestions(list => list.map((q, j) => j === i ? { ...q, ...patch } : q)); setProblems([]); };
  const move = (i, dir) => setQuestions(list => {
    const next = [...list];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    return next;
  });
  const setType = (i, type) => setQ(i, type === 'truefalse'
    ? { type, options: [...TRUE_FALSE], correct: null }
    : { type, options: ['', ''], correct: null });
  const setOption = (i, k, value) => setQ(i, { options: questions[i].options.map((o, m) => m === k ? value : o) });
  const removeOption = (i, k) => {
    const q = questions[i];
    setQ(i, {
      options: q.options.filter((_, m) => m !== k),
      correct: q.correct === k ? null : q.correct > k ? q.correct - 1 : q.correct,
    });
  };
  async function removeQuestion(i) {
    if (!await confirmDialog({ title: `Remove question ${i + 1}?`, message: questions[i].text || '(empty question)', confirmText: 'Remove', tone: 'warning' })) return;
    setQuestions(list => list.filter((_, j) => j !== i));
  }

  async function save() {
    const clean = questions.map(q => ({
      id: q.id, type: q.type, text: q.text.trim(), why: q.why.trim() || null,
      options: q.options.map(o => o.trim()), correct: q.correct,
    }));
    const pct = Number(passPct);
    const found = checkQuiz(clean, pct);
    if (found.length) return setProblems(found);
    const outside = clean.length < RECOMMENDED.min || clean.length > RECOMMENDED.max;
    if (!await confirmDialog({
      title: 'Save quiz?',
      message: `${clean.length} question${clean.length === 1 ? '' : 's'}, pass mark ${pct}%${active ? '' : ' — switched off'}.`
        + (outside ? ` (We recommend ${RECOMMENDED.min}–${RECOMMENDED.max} questions.)` : '')
        + (quiz ? ' Earlier results stay as they were.' : ''),
      confirmText: 'Save Quiz',
    })) return;
    setSaving(true);
    const row = await saveSopQuiz(quiz, sop.id, { questions: clean, passPct: pct, active }, user);
    setSaving(false);
    if (!row) return setProblems(['Could not save. Please try again.']);
    onSaved(row);
  }

  return (
    <Modal title={`${quiz ? 'Edit' : 'Add'} quiz — ${sop.title}`} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <p className="text-sm" style={{ marginTop: 0, padding: '6px 10px', borderRadius: 6, background: 'var(--surface-2)' }}>
          🔒 No patient information in questions or answers — use made-up examples.
          Aim for {RECOMMENDED.min}–{RECOMMENDED.max} short questions that check the key steps.
        </p>

        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <label className="row text-sm" style={{ gap: 6, alignItems: 'center' }}>
            Pass mark
            <input type="number" min={1} max={100} value={passPct} onChange={e => { setPassPct(e.target.value); setProblems([]); }}
              style={{ width: 80 }} /> %
          </label>
          <label className="row text-sm" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            Quiz switched on
          </label>
          {(questions.length < RECOMMENDED.min || questions.length > RECOMMENDED.max) && (
            <span className="badge badge-yellow">{questions.length} questions — {RECOMMENDED.min}–{RECOMMENDED.max} recommended</span>
          )}
        </div>

        {questions.map((q, i) => (
          <div key={q.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
            <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
              <span className="bold">Question {i + 1}</span>
              {[['choice', 'Multiple choice'], ['truefalse', 'True / False']].map(([t, label]) => (
                <button key={t} type="button" className={q.type === t ? 'btn-primary btn-sm' : 'btn-sm'} aria-pressed={q.type === t}
                  onClick={() => q.type !== t && setType(i, t)}>{label}</button>
              ))}
              <span className="row" style={{ marginLeft: 'auto', gap: 4 }}>
                <button type="button" className="btn-sm" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
                <button type="button" className="btn-sm" title="Move down" disabled={i === questions.length - 1} onClick={() => move(i, 1)}>▼</button>
                <button type="button" className="btn-sm" title="Remove question" onClick={() => removeQuestion(i)}>✕</button>
              </span>
            </div>
            <textarea rows={2} value={q.text} placeholder="e.g. Where do you check claim status in Waystar?"
              onChange={e => setQ(i, { text: e.target.value })} />

            <div className="text-sm text-muted" style={{ margin: '6px 0 4px' }}>Answers — tick the right one:</div>
            {q.options.map((o, k) => (
              <div key={k} className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <input type="radio" name={`correct-${q.id}`} checked={q.correct === k} onChange={() => setQ(i, { correct: k })}
                  aria-label={`Answer ${k + 1} is right`} />
                {q.type === 'truefalse'
                  ? <span>{o}</span>
                  : <input type="text" value={o} placeholder={`Answer ${k + 1}`} onChange={e => setOption(i, k, e.target.value)} style={{ flex: 1 }} />}
                {q.type === 'choice' && q.options.length > 2 && (
                  <button type="button" className="btn-sm" title="Remove answer" onClick={() => removeOption(i, k)}>✕</button>
                )}
              </div>
            ))}
            {q.type === 'choice' && q.options.length < MAX_OPTIONS && (
              <button type="button" className="btn-sm" onClick={() => setQ(i, { options: [...q.options, ''] })}>+ Add answer</button>
            )}
            <input type="text" value={q.why} placeholder="Why (optional) — shown after the quiz is passed" style={{ marginTop: 6 }}
              onChange={e => setQ(i, { why: e.target.value })} />
          </div>
        ))}
        {questions.length < MAX_QUESTIONS && (
          <button type="button" className="btn-sm" style={{ alignSelf: 'flex-start' }}
            onClick={() => setQuestions(list => [...list, blankQuestion()])}>+ Add question</button>
        )}

        {problems.length > 0 && (
          <ul className="text-sm" style={{ color: 'var(--danger)', paddingLeft: 18 }}>
            {problems.map(p => <li key={p}>{p}</li>)}
          </ul>
        )}
        <div className="form-actions">
          <button className="btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Quiz'}</button>
        </div>
      </div>
    </Modal>
  );
}
