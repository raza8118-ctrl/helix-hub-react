import { useState, useEffect } from 'react';
import { levelOf, placeholderMap } from '../../lib/appeals';
import { loadPayerInfo } from '../../lib/denialSteps';
import { fromKeyOf, computeDeadline, fmtDue, dateLabel, STATUS_STYLE, limitName } from '../../lib/deadlines';
import { typeOf } from '../../lib/denials';
import { payerFormLink } from '../../lib/payerForms';
import DenialLayers from './DenialLayers';
import CopyButton from '../../components/shared/CopyButton';
import { Card, Button, Check, Table, EmptyState } from '../../components/ui';

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
    <div className="ui-stack" style={{ gap: 'var(--ui-s4)' }}>
      <Card title="Deadline" icon="⏰">
        {!payer && <div className="ui-muted">Pick a payer to see the deadline.</div>}
        {payer && !data && <div className="ui-muted">Loading…</div>}
        {payer && data && !limit && (
          <div className="ui-muted">
            No {levelOf(form.level).label.toLowerCase()} limit recorded for {payer.name}. Use the Deadline helper in the Denial Navigator.
          </div>
        )}
        {limit && limit.days == null && <div className="ui-muted">The limit has no number of days — check the payer card.</div>}
        {rule && !result && <div className="ui-muted">Enter the {dateLabel(rule.fromKey)} to work it out.</div>}
        {result && (
          <div className="ui-result ui-small" style={{ borderLeftColor: STATUS_STYLE[result.status].color }}>
            {STATUS_STYLE[result.status].icon} <b>{limitName(limit)} due {fmtDue(result.due)}</b>
            <div style={{ color: STATUS_STYLE[result.status].color, fontWeight: 700, fontSize: 'var(--ui-fs-base)' }}>
              {result.daysLeft < 0 ? `${-result.daysLeft} days past due` : result.daysLeft === 0 ? 'Due today' : `${result.daysLeft} days left`}
            </div>
            <div className="ui-text-muted">{limit.days} days from the {dateLabel(rule.fromKey)} · {limit.isOverride ? `${client?.name} contract` : `${payer.name} standard`}</div>
            {result.weekend && <div>⚠ Falls on a {result.weekend} — send by {fmtDue(result.sendBy)}.</div>}
          </div>
        )}
      </Card>

      <Card title="Where to send it" icon="📮"
        actions={payer && <Button size="xs" onClick={() => onOpenPayer(payer)}>Payer card ›</Button>}>
        {!payer && <div className="ui-muted">Pick a payer.</div>}
        {data && !data.contacts.length && !data.forms.length && <div className="ui-muted">No appeals contact or forms recorded for {payer.name}.</div>}
        {data?.contacts.map(c => (
          <div key={c.id} className="ui-small" style={{ marginBottom: 'var(--ui-s2)' }}>
            {c.fax && <div>Fax {c.fax} <CopyButton value={c.fax} /></div>}
            {c.mailing_address && (
              <div style={{ whiteSpace: 'pre-wrap' }}>
                {c.attention_line ? `${c.attention_line}\n` : ''}{c.mailing_address}{' '}
                <CopyButton value={[c.attention_line, c.mailing_address].filter(Boolean).join('\n')} label="Copy address" />
              </div>
            )}
            {c.portal_url && <a href={c.portal_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>Appeals portal ↗</a>}
          </div>
        ))}
        {data?.forms.length > 0 && (
          <div className="ui-row" style={{ gap: 4 }}>
            {data.forms.map(f => <Button key={f.id} size="xs" onClick={() => download(f)}>⬇ {f.title}</Button>)}
          </div>
        )}
      </Card>

      {Array.isArray(steps) && matched.some(m => m.row) && (
        <Card title="Steps to follow" icon="🧩">
          <div className="ui-stack" style={{ gap: 'var(--ui-s2)' }}>
            {matched.filter(m => m.row).map(m => (
              <div key={m.row.id}>
                <Button size="sm" variant={openCode === m.row.id ? 'primary' : 'secondary'} aria-expanded={openCode === m.row.id}
                  onClick={() => setOpenCode(openCode === m.row.id ? null : m.row.id)}>
                  {typeOf(m.row.code_type).label} {m.row.code} {openCode === m.row.id ? '▴' : '▾'}
                </Button>
                {openCode === m.row.id && (
                  <DenialLayers code={m.row} steps={steps} ctx={ctx} client={client} payer={payer} user={user} canEdit={false}
                    onChanged={() => {}} onOpenSop={onOpenSop} onOpenPayer={onOpenPayer} />
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Facts summary" icon="🧾"
        actions={<Check inline checked={showEmpty} onChange={e => setShowEmpty(e.target.checked)}>Show empty</Check>}>
        <div className="ui-muted" style={{ marginBottom: 'var(--ui-s2)' }}>
          Letters (next steps) use these placeholders. 🔒 = identifier: only the placeholder ever leaves this computer.
        </div>
        {shown.length === 0 && <EmptyState compact title="Nothing filled in yet." />}
        {shown.length > 0 && (
          <Table dense>
            <tbody>
              {shown.map(r => (
                <tr key={r.token}>
                  <td style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}><code>{r.token}</code>{r.id ? ' 🔒' : ''}</td>
                  <td style={{ overflowWrap: 'anywhere' }}>{r.value || <span className="ui-text-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
