import { SOP_SECTIONS, sopSteps, sopSectionFilled } from '../../lib/sops';
import SopText from './SopText';
import { SopImage, SopVideo } from './SopMedia';

/**
 * The template sections of one SOP (roadmap 3.2/3.3) — used by the SOP page and the editor's Preview.
 * showEmpty = show unfilled sections as "Not filled in yet" (editors).
 */
export default function SopContent({ sop, showEmpty }) {
  const steps = sopSteps(sop).filter(s => s.text.trim());

  function renderSection({ key, label }) {
    const filled = sopSectionFilled(sop, key);
    if (!filled && !showEmpty) return null;
    let body;
    if (!filled) body = <div className="text-sm text-muted">Not filled in yet.</div>;
    else if (key === 'audience') body = (
      <div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {(sop.audience_teams ?? []).map(t => <span key={t} className="badge badge-blue">{t}</span>)}
        </div>
        {sop.audience_notes && <SopText text={sop.audience_notes} style={{ marginTop: 6 }} />}
      </div>
    );
    else if (key === 'steps') body = (
      <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
        {steps.map((s, i) => (
          <li key={i} className="row" style={{ gap: 10, alignItems: 'flex-start', padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <span style={{
              flex: '0 0 28px', height: 28, borderRadius: '50%', background: 'var(--accent)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 13,
            }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SopText text={s.text} />
              {s.tip && (
                <div className="text-sm row" style={{ gap: 4, alignItems: 'flex-start', marginTop: 4, color: 'var(--text-muted)' }}>
                  <span>💡</span><SopText text={s.tip} />
                </div>
              )}
              {s.images.length > 0 && (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {s.images.map(img => <SopImage key={img.path} image={img} alt={`Step ${i + 1} screenshot`} />)}
                </div>
              )}
              {s.video && <div style={{ marginTop: 8 }}><SopVideo video={s.video} maxWidth={520} /></div>}
            </div>
          </li>
        ))}
      </ol>
    );
    else body = <SopText text={sop[key]} />;
    return (
      <div key={key} className="card mb-16">
        <div className="card-title" style={{ marginBottom: 8 }}>{label}</div>
        {body}
      </div>
    );
  }

  return (
    <>
      {sop.walkthrough_video?.path && (
        <div className="card mb-16">
          <div className="card-title" style={{ marginBottom: 8 }}>▶ Watch the walkthrough</div>
          <SopVideo video={sop.walkthrough_video} />
        </div>
      )}
      {!showEmpty && !SOP_SECTIONS.some(s => sopSectionFilled(sop, s.key)) && (
        <div className="card mb-16 text-muted">This SOP doesn’t have any content yet.</div>
      )}
      {SOP_SECTIONS.map(renderSection)}
    </>
  );
}
