import { useState, useEffect } from 'react';
import { loadSopQuiz, loadMyAttempts, summarise, shuffledOrder, scoreQuiz, saveAttempt } from '../../lib/sopQuiz';
import SopQuizEditor from './SopQuizEditor';

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

/**
 * "📝 Take the quiz" card at the bottom of an SOP (roadmap 3.6), plus "Edit quiz" for SOP editors.
 * Failed attempts show which questions were wrong (not the right answers); passing shows the answers and "Why".
 */
export default function SopQuiz({ sop, user, canEdit }) {
  const [quiz, setQuiz] = useState(undefined);       // undefined = loading / not set up, null = no quiz
  const [attempts, setAttempts] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [run, setRun] = useState(null);              // { orders, answers } while taking it
  const [result, setResult] = useState(null);        // { score, answers } after submitting
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const empId = user.emp_id;
  useEffect(() => {
    let alive = true;
    Promise.all([loadSopQuiz(sop.id), loadMyAttempts(sop.id, empId)]).then(([q, a]) => {
      if (!alive) return;
      setQuiz(q);
      setAttempts(a);
    });
    return () => { alive = false; };
  }, [sop.id, empId, reloadKey]);

  if (quiz === undefined) return null;   // loading, or the quiz database update hasn't been run
  const usable = quiz && quiz.active !== false && quiz.questions?.length > 0;
  if (!usable && !canEdit) return null;

  const mine = summarise(attempts)[empId];

  function start() {
    setResult(null);
    setError('');
    setRun({
      orders: quiz.questions.map(q => q.type === 'truefalse' ? [0, 1] : shuffledOrder(q.options.length)),
      answers: quiz.questions.map(() => null),
    });
  }
  const choose = (i, optionIndex) => setRun(r => ({ ...r, answers: r.answers.map((a, j) => j === i ? optionIndex : a) }));

  async function submit() {
    if (run.answers.some(a => a == null)) return setError('Please answer every question.');
    const score = scoreQuiz(quiz, run.answers);
    setSaving(true);
    const saved = await saveAttempt(quiz, run.answers, score, user);
    setSaving(false);
    if (!saved) return setError('Your answers could not be saved. Please try again.');
    setResult({ score, answers: run.answers });
    setRun(null);
    setAttempts(list => [saved, ...list]);
  }

  return (
    <div className="card mb-16">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        <span className="card-title">📝 Quiz</span>
        {usable && <span className="text-sm text-muted">{quiz.questions.length} questions · pass mark {quiz.pass_pct}%</span>}
        {mine && (
          <span className={`badge ${mine.passedAt ? 'badge-green' : 'badge-orange'}`}>
            Your best: {mine.best}%{mine.passedAt ? ` · passed ${fmtDate(mine.passedAt)}` : ' · not passed yet'}
          </span>
        )}
        {canEdit && (
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setEditing(true)}>
            📝 {quiz ? 'Edit quiz' : 'Add a quiz'}
          </button>
        )}
      </div>

      {canEdit && !usable && (
        <div className="text-sm text-muted">
          {quiz ? 'The quiz is switched off or has no questions — readers don’t see it.' : 'No quiz yet. Add 3–5 short questions to check understanding.'}
        </div>
      )}

      {usable && !run && !result && (
        <button className="btn-primary btn-sm" onClick={start}>{mine ? 'Take the quiz again' : 'Take the quiz'}</button>
      )}

      {usable && run && (
        <div>
          {quiz.questions.map((q, i) => (
            <fieldset key={q.id ?? i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, margin: '8px 0' }}>
              <legend className="bold text-sm" style={{ padding: '0 4px' }}>Question {i + 1}</legend>
              <div style={{ marginBottom: 6, whiteSpace: 'pre-wrap' }}>{q.text}</div>
              {run.orders[i].map(k => (
                <label key={k} className="row text-sm" style={{ gap: 8, padding: '4px 0', cursor: 'pointer', alignItems: 'center' }}>
                  <input type="radio" name={`quiz-${sop.id}-${i}`} checked={run.answers[i] === k} onChange={() => choose(i, k)} />
                  {q.options[k]}
                </label>
              ))}
            </fieldset>
          ))}
          {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
          <div className="row" style={{ gap: 6 }}>
            <button className="btn-sm" onClick={() => setRun(null)} disabled={saving}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Submit answers'}</button>
          </div>
        </div>
      )}

      {usable && result && (
        <div>
          <div className="bold" style={{ margin: '6px 0', color: result.score.passed ? 'var(--success)' : 'var(--danger)' }}>
            {result.score.correct} of {result.score.total} ({result.score.scorePct}%) — {result.score.passed ? '✅ Passed' : '❌ Not passed yet'}
          </div>
          {!result.score.passed && (
            <div className="text-sm" style={{ marginBottom: 6 }}>Review the SOP and try again. The questions you got wrong:</div>
          )}
          {quiz.questions.map((q, i) => {
            const right = result.score.results[i];
            if (!result.score.passed && right) return null;
            return (
              <div key={q.id ?? i} className="text-sm" style={{
                padding: '6px 10px', margin: '4px 0', borderRadius: 6,
                borderLeft: `4px solid ${right ? 'var(--success)' : 'var(--danger)'}`, background: 'var(--surface-2)',
              }}>
                <div>{right ? '✓' : '✗'} <b>Q{i + 1}.</b> {q.text}</div>
                {result.score.passed && (
                  <>
                    <div>Right answer: <b>{q.options[q.correct]}</b>{!right ? ` (you chose “${q.options[result.answers[i]]}”)` : ''}</div>
                    {q.why && <div className="text-muted">Why: {q.why}</div>}
                  </>
                )}
              </div>
            );
          })}
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            <button className="btn-sm" onClick={() => setResult(null)}>Close</button>
            <button className="btn-primary btn-sm" onClick={start}>Take it again</button>
          </div>
        </div>
      )}

      {editing && (
        <SopQuizEditor sop={sop} quiz={quiz} user={user} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); setRun(null); setResult(null); setReloadKey(k => k + 1); }} />
      )}
    </div>
  );
}
