import { useState, useEffect } from 'react';
import { levelOf, placeholderMap } from '../../lib/appeals';
import { loadPayerInfo } from '../../lib/denialSteps';
import { fromKeyOf, computeDeadline, fmtDue, dateLabel, STATUS_STYLE, limitName } from '../../lib/deadlines';
import { typeOf } from '../../lib/denials';
import { payerFormLink } from '../../lib/payerForms';
import DenialLayers from './DenialLayers';
import CopyButton from '../../components/shared/CopyButton';

const cell = { padding: '3px 6px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' };

/**
 * Appeal Builder side panel (roadmap 5.1): deadline for the chosen appeal level, where to send it (Payer Directory),
 * the Denial Navigator steps for each code, and the facts summary with placeholders.
 */
export default function AppealSidePanel({ form, effectiveType, client, payer, matched, steps, ctx, user, onOpenSop, onOpenPayer }) {
  const [info, setInfo] = useState({ key: null, data: null });
  const [openCode, setOpenCode] = useState(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const key = payer ? `${payer.id}|${client?.id ?? ''}` : null;
  useEffect(() => {
    let alive = true;
    if (payer) loadPayerInfo(payer.id, client?.id ?? null).then(data => { if (alive) setInfo({ key, data }); });
    return () => { alive = false; };
  }, [payer, client?.id, key]);
  const data = info.key === key ? info.data : null;

  // Deadline for the chosen level
  const want = levelOf(form.level).limit;
  const limit = data?.limits.find(l => l.limit_type === want.type && (want.level == null || (l.level ?? 1) === want.level));
  const rule = limit && limit.days != null ? { days: limit.days, fromKey: fromKeyOf(limit.measured_from).key, receiptDays: 0 } : null;
  const result = rule ? computeDeadline(rule, { denial: form.denial_date, dos: form.dos_to || form.dos_from, discharge: '', paid: '' }) : null;

  async function download(f) {
    const url = await payerFormLink(f.file_path, f.file_name);
    if (url) window.location.href = url;
  }

  const rows = placeholderMap({ ...form, denial_type: effectiveType }, {
    clientName: client?.name, payerName: payer?.name,
    codesText: matched.map(m => `${m.parsed.group ? `${m.parsed.group}-` : ''}${m.parsed.code}`).join(', '),
    reasonText: matched.map(m => m.row?.plain_reason).filter(Boolean).join(' '),
  });
  const shown = showEmpty ? rows : rows.filter(r => r.value);

  return (
    <div>
      <div className="card mb-16">
        <div className="card-title" style={{ marginBottom: 6 }}>⏰ Deadline</div>
        {!payer && <div className="text-sm text-muted">Pick a payer to see the deadline.</div>}
        {payer && !data && <div className="text-sm text-muted">Loading…</div>}
        {payer && data && !limit && (
          <div className="text-sm text-muted">
            No {levelOf(form.level).label.toLowerCase()} limit recorded for {payer.name}. Use the Deadline helper in the Denial Navigator.
          </div>
        )}
        {limit && limit.days == null && <div className="text-sm text-muted">The limit has no number of days — check the payer card.</div>}
        {rule && !result && <div className="text-sm text-muted">Enter the {dateLabel(rule.fromKey)} to work it out.</div>}
        {result && (
          <div className="text-sm">
            {STATUS_STYLE[result.status].icon} <b>{limitName(limit)} due {fmtDue(result.due)}</b>
            <div style={{ color: STATUS_STYLE[result.status].color, fontWeight: 600 }}>
              {result.daysLeft < 0 ? `${-result.daysLeft} days past due` : result.daysLeft === 0 ? 'Due today' : `${result.daysLeft} days left`}
            </div>
            <div className="text-muted">{limit.days} days from the {dateLabel(rule.fromKey)} · {limit.isOverride ? `${client?.name} contract` : `${payer.name} standard`}</div>
            {result.weekend && <div>⚠ Falls on a {result.weekend} — send by {fmtDue(result.sendBy)}.</div>}
          </div>
        )}
      </div>

      <div className="card mb-16">
        <div className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <span className="card-title">📮 Where to send it</span>
          {payer && <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => onOpenPayer(payer)}>Payer card ›</button>}
        </div>
        {!payer && <div className="text-sm text-muted">Pick a payer.</div>}
        {data && !data.contacts.length && !data.forms.length && <div className="text-sm text-muted">No appeals contact or forms recorded for {payer.name}.</div>}
        {data?.contacts.map(c => (
          <div key={c.id} className="text-sm" style={{ marginBottom: 6 }}>
            {c.fax && <div>Fax {c.fax} <CopyButton value={c.fax} /></div>}
            {c.mailing_address && (
              <div style={{ whiteSpace: 'pre-wrap' }}>
                {c.attention_line ? `${c.attention_line}\n` : ''}{c.mailing_address}{' '}
                <CopyButton value={[c.attention_line, c.mailing_address].filter(Boolean).join('\n')} label="Copy address" />
              </div>
            )}
            {c.portal_url && <a href={c.portal_url} target="_blank" rel="noopener noreferrer">Appeals portal ↗</a>}
          </div>
        ))}
        {data?.forms.length > 0 && (
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {data.forms.map(f => <button key={f.id} className="btn-sm" onClick={() => download(f)}>⬇ {f.title}</button>)}
          </div>
        )}
      </div>

      {Array.isArray(steps) && matched.some(m => m.row) && (
        <div className="card mb-16">
          <div className="card-title" style={{ marginBottom: 6 }}>🧩 Steps to follow</div>
          {matched.filter(m => m.row).map(m => (
            <div key={m.row.id} style={{ marginBottom: 6 }}>
              <button className={openCode === m.row.id ? 'btn-primary btn-sm' : 'btn-sm'} onClick={() => setOpenCode(openCode === m.row.id ? null : m.row.id)}>
                {typeOf(m.row.code_type).label} {m.row.code} {openCode === m.row.id ? '▴' : '▾'}
              </button>
              {openCode === m.row.id && (
                <DenialLayers code={m.row} steps={steps} ctx={ctx} client={client} payer={payer} user={user} canEdit={false}
                  onChanged={() => {}} onOpenSop={onOpenSop} onOpenPayer={onOpenPayer} />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card mb-16">
        <div className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <span className="card-title">🧾 Facts summary</span>
          <label className="row text-sm" style={{ gap: 4, cursor: 'pointer', marginLeft: 'auto' }}>
            <input type="checkbox" checked={showEmpty} onChange={e => setShowEmpty(e.target.checked)} /> Show empty
          </label>
        </div>
        <div className="text-sm text-muted" style={{ marginBottom: 6 }}>
          Letters (next steps) use these placeholders. 🔒 = identifier: only the placeholder ever leaves this computer.
        </div>
        {shown.length === 0 && <div className="text-sm text-muted">Nothing filled in yet.</div>}
        {shown.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="text-sm" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {shown.map(r => (
                  <tr key={r.token}>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}><code>{r.token}</code>{r.id ? ' 🔒' : ''}</td>
                    <td style={{ ...cell, overflowWrap: 'anywhere' }}>{r.value || <span className="text-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
