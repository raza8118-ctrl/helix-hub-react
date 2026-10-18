import { Card, Badge, H2, SectionLabel } from '../../components/shared/UI';
import { WORKBENCH_MODULES } from './modules';

/** "Coming soon" page shown for a Workbench module that hasn't been built yet. */
export default function WorkbenchPlaceholder({ tabId }) {
  const mod = WORKBENCH_MODULES.find(m => m.id === tabId);
  if (!mod) return null;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{
          width: 56, height: 56, borderRadius: 14, flexShrink: 0,
          background: 'var(--surface-2)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
        }}>
          {mod.icon}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
              {mod.label}
            </span>
            <Badge label="Coming soon" color="purple" />
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>{mod.purpose}</div>
        </div>
      </Card>

      <Card>
        <H2 icon="🛠️">What’s planned</H2>
        <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mod.planned.map(item => (
            <li key={item} style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.5 }}>{item}</li>
          ))}
        </ul>
        <SectionLabel style={{ marginTop: 16, marginBottom: 0 }}>Roadmap phase {mod.phase}</SectionLabel>
      </Card>
    </div>
  );
}
