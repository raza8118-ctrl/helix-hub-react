import { parseSopText, parseSopInline } from '../../lib/sopText';

function Inline({ line }) {
  return parseSopInline(line).map((p, i) =>
    p.t === 'bold' ? <b key={i}>{p.v}</b>
    : p.t === 'link' ? <a key={i} href={p.v} target="_blank" rel="noopener noreferrer">{p.v}</a>
    : <span key={i}>{p.v}</span>);
}

/** SOP text with its simple formatting (bold, bullets, numbers, ⚠ important, links) — roadmap 3.3. */
export default function SopText({ text, style }) {
  const blocks = parseSopText(text);
  if (!blocks.length) return null;
  return (
    <div style={{ lineHeight: 1.55, overflowWrap: 'anywhere', ...style }}>
      {blocks.map((b, i) => {
        if (b.type === 'gap') return <div key={i} style={{ height: 8 }} />;
        if (b.type === 'ul' || b.type === 'ol') {
          const List = b.type;
          return (
            <List key={i} style={{ margin: '2px 0', paddingLeft: 22 }}>
              {b.lines.map((l, j) => <li key={j}><Inline line={l} /></li>)}
            </List>
          );
        }
        if (b.type === 'important') return (
          <div key={i} style={{
            margin: '6px 0', padding: '6px 10px', borderRadius: 6,
            borderLeft: '4px solid var(--warning)', background: 'var(--surface-2)',
          }}>
            ⚠ <Inline line={b.lines[0]} />
          </div>
        );
        return <div key={i}>{b.lines.map((l, j) => <div key={j}><Inline line={l} /></div>)}</div>;
      })}
    </div>
  );
}
