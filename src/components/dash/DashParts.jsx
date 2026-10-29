// 📈 Team Dashboard building blocks — the look of the PO's sample kit (helix-ui-kit), rebuilt with plain React + SVG
// and the `.hx-*` rules at the end of index.css. No chart / animation / icon libraries. Charts size to real pixels.
import { useState, useRef, useLayoutEffect, useEffect, useId } from 'react';

const TONE_HEX = { good: '#34d399', warn: '#fbbf24', bad: '#f87171', none: '#94a3b8' };

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(e => { const x = e[0]?.contentRect?.width; if (x) setW(x); });
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const niceMax = v => {
  if (!v || v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(k => k * p).find(k => k >= v) ?? v;
};
const fmtAxis = v => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v * 10) / 10));
const smooth = pts => pts.reduce((d, [x, y], i) => {
  if (!i) return `M${x},${y}`;
  const [x0, y0] = pts[i - 1];
  const cx = (x0 + x) / 2;
  return `${d} C${cx},${y0} ${cx},${y} ${x},${y}`;
}, '');

// ── Small pieces ──────────────────────────────────────────────────────────────

export function Chip({ tone = 'none', children }) {
  return <span className={`hx-chip hx-tone-${tone}`}>{children}</span>;
}

export function Meter({ value, max = 120, tone = 'none' }) {
  const w = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return <div className="hx-meter"><span style={{ width: `${w}%`, background: TONE_HEX[tone] }} /></div>;
}

export function Avatar({ name, size = 28 }) {
  const parts = String(name ?? '?').trim().split(/\s+/);
  const ini = ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts.at(-1)[0] : '')).toUpperCase();
  let h = 0;
  for (const c of String(name ?? '')) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className="hx-avatar" aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 75% 45%))` }}>
      {ini}
    </span>
  );
}

/** Day / Week / Month switch. options = [{ value, label }] */
export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="hx-seg" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Pick one month, several, or a quick pick (quarter, last 3 / 12 months). */
export function MonthPicker({ months, value, onChange, quick, label }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    const close = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, []);
  const has = new Set(value);
  const toggle = m => { const next = has.has(m) ? value.filter(x => x !== m) : [...value, m]; if (next.length) onChange([...next].sort()); };
  const same = ms => ms.length === value.length && ms.every(m => has.has(m));
  return (
    <div className="hx-mpick" ref={box}>
      <button type="button" className="hx-mpick-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {label}{value.length > 1 && <span className="hx-mpick-n">{value.length}</span>} ▾
      </button>
      {open && (
        <div className="hx-mpick-pop">
          <div className="hx-mini-h">Quick pick</div>
          <div className="hx-mpick-quick">
            {quick.map(q => (
              <button key={q.label} type="button" className={same(q.months) ? 'on' : ''}
                onClick={() => { onChange([...q.months].sort()); setOpen(false); }}>{q.label}</button>
            ))}
          </div>
          <div className="hx-mini-h">Months · tick one or more</div>
          <ul role="listbox" aria-multiselectable="true">
            {[...months].reverse().map(m => (
              <li key={m}>
                <button type="button" role="option" aria-selected={has.has(m)} className={has.has(m) ? 'on' : ''} onClick={() => toggle(m)}>
                  <span className="hx-tick">{has.has(m) ? '✓' : ''}</span>{m.slice(0, 4)} · {new Date(`${m}-15`).toLocaleString('en-US', { month: 'long' })}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Mini trend wave along the bottom of a tile. */
export function Sparkline({ values = [], color = 'var(--accent)' }) {
  const [ref, w] = useWidth();
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null && !Number.isNaN(v));
  const h = 30;
  let path = null;
  if (w && pts.length >= 2) {
    const lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
    const n = Math.max(1, values.length - 1);
    const xy = pts.map(([i, v]) => [Math.round((i / n) * w * 10) / 10, Math.round((h - 3 - ((v - lo) / (hi - lo || 1)) * (h - 8)) * 10) / 10]);
    const line = smooth(xy);
    path = { line, area: `${line} L${xy.at(-1)[0]},${h} L${xy[0][0]},${h} Z` };
  }
  return (
    <div className="hx-spark" ref={ref} aria-hidden="true">
      {path && (
        <svg width={w} height={h}>
          <path d={path.area} fill={color} opacity="0.13" />
          <path d={path.line} fill="none" stroke={color} strokeWidth="1.5" opacity="0.6" />
        </svg>
      )}
    </div>
  );
}

/** compare = { better: true | false | null, up } from compareOf(). */
function Arrow({ compare }) {
  if (!compare) return null;
  if (compare.better == null) return <span className="hx-cmp" title="Same as the previous period">–</span>;
  return (
    <span className={`hx-cmp ${compare.better ? 'good' : 'bad'}`} title={compare.better ? 'Better than the previous period' : 'Worse than the previous period'}>
      {compare.up ? '▲' : '▼'}
    </span>
  );
}

/** Number tile with a mini trend and a better / worse arrow. Click opens the details pop-up. */
export function StatTile({ label, value, sub, trend, compare, tone, rank, onClick, note }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`hx-tile${onClick ? ' click' : ''}`} onClick={onClick}
      title={onClick ? 'Click to see the details' : undefined}>
      {trend && <Sparkline values={trend} />}
      <div className="hx-tile-top"><span>{label}</span>{rank && <span className="hx-rank">#{rank}</span>}</div>
      <div className={`hx-tile-val hx-text-${tone ?? 'none'}`}>{value}</div>
      {note && <div className="hx-tile-note">{note}</div>}
      <div className="hx-tile-sub"><span>{sub}</span><Arrow compare={compare} /></div>
    </Tag>
  );
}

/** Coloured badge in the summary card (Prod %, Qual %, Shrinkage, rank). */
export function Badge({ label, value, tone = 'none', rank, onClick }) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`hx-badge ${rank ? 'rank' : `hx-tone-${tone}`}${onClick ? ' click' : ''}`} onClick={onClick}>
      <span className="hx-badge-l">{rank && '🏆 '}{label}</span>
      <span className="hx-badge-v">{value}</span>
    </Tag>
  );
}

// ── Dark "command centre" panel ───────────────────────────────────────────────

export function Panel({ children }) {
  return <div className="hx-panel"><div className="hx-panel-grid">{children}</div></div>;
}

export function Glass({ title, sub, right, wide, children }) {
  return (
    <section className={`hx-glass${wide ? ' wide' : ''}`}>
      {(title || right) && (
        <div className="hx-glass-h">
          <div><div className="hx-glass-t">{title}</div>{sub && <div className="hx-glass-s">{sub}</div>}</div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function PanelTabs({ tabs, value, onChange, badge }) {
  return (
    <div className="hx-ptabs">
      <div role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={value === id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>{label}</button>
        ))}
      </div>
      {badge && <span className="hx-ptabs-b">{badge}</span>}
    </div>
  );
}

export function Empty({ children = 'No data for this period' }) {
  return <div className="hx-empty">{children}</div>;
}

export function Legend({ items }) {
  return (
    <div className="hx-legend">
      {items.map(([label, color, dashed]) => (
        <span key={label}><i style={{ background: dashed ? 'transparent' : color, borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }} />{label}</span>
      ))}
    </div>
  );
}

// ── Charts (for the dark panel: light text on dark) ───────────────────────────

/**
 * Bars and lines over buckets. series = [{ key, label, type: 'bar' | 'line', color, axis: 'left' | 'right', dashed, unit }].
 * refY = target line on the left axis. pillKey shows a small % pill above each bucket. onPick(bucket) on click.
 */
export function TrendChart({ data, xKey = 'label', series, refY, pillKey, height = 230, onPick, yMax }) {
  const [ref, w] = useWidth();
  const [hov, setHov] = useState(-1);
  const gid = `hxg${useId().replace(/[^A-Za-z0-9]/g, '')}`;
  const PL = 40, PR = series.some(s => s.axis === 'right') ? 40 : 12, PT = pillKey ? 24 : 12, PB = 26;
  const n = data.length;
  if (!n) return <div ref={ref}><Empty /></div>;
  const left = series.filter(s => s.axis !== 'right'), right = series.filter(s => s.axis === 'right');
  const maxOf = ss => Math.max(0, ...ss.flatMap(s => data.map(d => Number(d[s.key]) || 0)), ...(refY ? [refY] : []));
  const lMax = yMax ?? niceMax(maxOf(left) * 1.08), rMax = niceMax(Math.max(0, ...right.flatMap(s => data.map(d => Number(d[s.key]) || 0))) * 1.1);
  const iw = Math.max(10, w - PL - PR), ih = height - PT - PB;
  const step = iw / n;
  const bars = left.filter(s => s.type === 'bar').concat(right.filter(s => s.type === 'bar'));
  const bw = Math.max(3, Math.min(28, (step * 0.7) / Math.max(1, bars.length)));
  const y = (v, s) => PT + ih - ((Number(v) || 0) / (s?.axis === 'right' ? rMax : lMax)) * ih;
  const every = Math.ceil(n / Math.max(1, Math.floor(iw / 46)));
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const fmtV = (v, s) => (v == null ? '—' : s.unit === '%' ? `${Math.round(v * 10) / 10}%` : s.unit === 'h' ? `${Math.round(v * 10) / 10}h` : Number(Math.round(v * 10) / 10).toLocaleString());

  return (
    <div className="hx-chart" ref={ref} onMouseLeave={() => setHov(-1)}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={series.map(s => s.label).join(', ')}>
          <defs>
            {series.map((s, k) => (
              <linearGradient key={k} id={`${gid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.95" /><stop offset="100%" stopColor={s.color} stopOpacity="0.35" />
              </linearGradient>
            ))}
          </defs>
          {ticks.map(t => (
            <g key={t}>
              <line x1={PL} x2={PL + iw} y1={PT + ih - t * ih} y2={PT + ih - t * ih} className="hx-grid" />
              <text x={PL - 6} y={PT + ih - t * ih + 3} textAnchor="end" className="hx-ax">{fmtAxis(lMax * t)}</text>
              {right.length > 0 && <text x={PL + iw + 6} y={PT + ih - t * ih + 3} className="hx-ax">{fmtAxis(rMax * t)}</text>}
            </g>
          ))}
          {refY != null && <line x1={PL} x2={PL + iw} y1={y(refY)} y2={y(refY)} className="hx-ref" />}
          {hov >= 0 && <rect x={PL + hov * step} y={PT} width={step} height={ih} className="hx-hov" />}
          {data.map((d, i) => bars.map((s, k) => {
            const x = PL + i * step + step / 2 - (bars.length * bw) / 2 + k * bw;
            const top = y(d[s.key], s);
            return <rect key={`${i}-${s.key}`} x={x} y={top} width={bw - 1} height={Math.max(0, PT + ih - top)} rx={Math.min(4, bw / 3)}
              fill={s.ghost ? 'rgba(255,255,255,0.10)' : `url(#${gid}-${s.key})`} stroke={s.ghost ? 'rgba(255,255,255,0.25)' : 'none'} strokeDasharray={s.ghost ? '3 2' : undefined} />;
          }))}
          {series.filter(s => s.type !== 'bar').map(s => {
            const pts = data.map((d, i) => [PL + i * step + step / 2, d[s.key]]).filter(p => p[1] != null).map(([x, v]) => [Math.round(x * 10) / 10, Math.round(y(v, s) * 10) / 10]);
            if (!pts.length) return null;
            return (
              <g key={s.key}>
                {pts.length > 1 && <path d={smooth(pts)} fill="none" stroke={s.color} strokeWidth="2.2" strokeDasharray={s.dashed ? '5 4' : undefined} className="hx-glow" />}
                {pts.map(([x, yy], k) => <circle key={k} cx={x} cy={yy} r={n > 24 ? 1.8 : 3} fill={s.color} />)}
              </g>
            );
          })}
          {pillKey && data.map((d, i) => d[pillKey] != null && (n <= 14 || i % every === 0) && (
            <text key={i} x={PL + i * step + step / 2} y={PT - 8} textAnchor="middle" className="hx-pill-t">{Math.round(d[pillKey])}%</text>
          ))}
          {data.map((d, i) => i % every === 0 && (
            <text key={i} x={PL + i * step + step / 2} y={height - 8} textAnchor="middle" className="hx-ax">{d[xKey]}</text>
          ))}
          {data.map((d, i) => (
            <rect key={i} x={PL + i * step} y={PT} width={step} height={ih} fill="transparent"
              style={{ cursor: onPick ? 'pointer' : 'default' }} onMouseEnter={() => setHov(i)} onClick={() => onPick?.(d)} />
          ))}
        </svg>
      )}
      {hov >= 0 && data[hov] && (
        <div className="hx-tip" style={{ left: Math.min(Math.max(PL + hov * step + step / 2, 70), Math.max(70, w - 70)) }}>
          <b>{data[hov][xKey]}</b>
          {series.map(s => <div key={s.key}><i style={{ background: s.color }} />{s.label}: <b>{fmtV(data[hov][s.key], s)}</b></div>)}
          {onPick && <div className="hx-tip-hint">Click for the records</div>}
        </div>
      )}
    </div>
  );
}

/** Donut + centre text. data = [{ name, value, fill }] */
export function Donut({ data, center, caption, size = 170 }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <Empty />;
  const r = size / 2 - 14, c = size / 2, sw = 20;
  // Start / end angle of each slice from the running total (12 o'clock, clockwise)
  const angle = v => -Math.PI / 2 + (v / total) * Math.PI * 2;
  const starts = data.map((_, i) => data.slice(0, i).reduce((s, d) => s + d.value, 0));
  const arcs = data.map((d, i) => {
    const a0 = angle(starts[i]), a1 = angle(starts[i] + d.value);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = d.value === total
      ? `M${c},${c - r} A${r},${r} 0 1 1 ${c - 0.01},${c - r}`
      : `M${c + r * Math.cos(a0)},${c + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${c + r * Math.cos(a1)},${c + r * Math.sin(a1)}`;
    return { ...d, p };
  });
  return (
    <div className="hx-donut">
      <svg width={size} height={size} role="img" aria-label={data.map(d => `${d.name} ${d.value}`).join(', ')}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw} />
        {arcs.map(a => <path key={a.name} d={a.p} fill="none" stroke={a.fill} strokeWidth={sw} className="hx-glow" />)}
        <text x={c} y={c} textAnchor="middle" className="hx-donut-c">{center}</text>
        <text x={c} y={c + 16} textAnchor="middle" className="hx-ax">{caption}</text>
      </svg>
      <ul className="hx-mix">
        {data.map(d => (
          <li key={d.name}><i style={{ background: d.fill }} />{d.name}<b>{d.value.toLocaleString()}</b><span>{Math.round((d.value / total) * 100)}%</span></li>
        ))}
      </ul>
    </div>
  );
}

/** Ranked bars. rows = [{ key, name, value, sub? }], fmt(value), color(value). */
export function BarList({ rows, fmt, max, color, onRowClick, limit = 12 }) {
  if (!rows.length) return <Empty />;
  const top = max ?? Math.max(...rows.map(r => r.value ?? 0), 1);
  const shown = rows.slice(0, limit);
  return (
    <ul className="hx-barlist">
      {shown.map((r, i) => {
        const Tag = onRowClick ? 'button' : 'div';
        return (
          <li key={r.key}>
            <Tag type={onRowClick ? 'button' : undefined} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              <span className="hx-bl-n"><em>{i + 1}</em>{r.name}</span>
              <span className="hx-bl-v">{fmt(r.value)}</span>
              <span className="hx-bl-bar"><i style={{ width: `${Math.max(2, Math.min(100, ((r.value ?? 0) / top) * 100))}%`, background: color(r.value) }} /></span>
            </Tag>
          </li>
        );
      })}
      {rows.length > shown.length && <li className="hx-more">+{rows.length - shown.length} more in the table below</li>}
    </ul>
  );
}

/** Rows × columns of coloured cells. rows = [{ key, label, cells: [number|null] }] */
export function HeatGrid({ columns, rows, tone, fmt = v => `${Math.round(v)}%` }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="hx-heat-wrap">
      <table className="hx-heat">
        <thead><tr><th />{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <th>{r.label}</th>
              {r.cells.map((v, i) => (
                <td key={i}><span className={`hx-cell hx-tone-${v == null ? 'none' : tone(v)}`} title={v == null ? 'No data' : `${r.label} · ${columns[i]}: ${fmt(v)}`}>{v == null ? '' : fmt(v)}</span></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HeatLegend() {
  return <Legend items={[['On target', TONE_HEX.good], ['Close', TONE_HEX.warn], ['Below', TONE_HEX.bad]]} />;
}

/** Stacked horizontal bars per person. series = [[key, label, color]] */
export function HBars({ rows, series, onRowClick, limit = 10 }) {
  const shown = rows.filter(r => series.some(([k]) => r[k] > 0)).slice(0, limit);
  if (!shown.length) return <Empty>No flags in this period 🎉</Empty>;
  const max = Math.max(...shown.map(r => series.reduce((s, [k]) => s + (r[k] || 0), 0)), 1);
  return (
    <div>
      <ul className="hx-hbars">
        {shown.map(r => (
          <li key={r.key}>
            <button type="button" onClick={() => onRowClick?.(r)} disabled={!onRowClick}>
              <span className="hx-hb-n">{r.name}</span>
              <span className="hx-hb-bar">
                {series.map(([k, label, c]) => r[k] > 0 && (
                  <i key={k} style={{ width: `${(r[k] / max) * 100}%`, background: c }} title={`${label}: ${r[k]}`}>{r[k]}</i>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Legend items={series.map(([, label, c]) => [label, c])} />
    </div>
  );
}

/** Small numbers row at the bottom of a glass card. items = [{ label, value, onClick }] */
export function MiniStats({ items }) {
  return (
    <div className="hx-ministats">
      {items.map(it => {
        const Tag = it.onClick ? 'button' : 'div';
        return (
          <Tag key={it.label} type={it.onClick ? 'button' : undefined} onClick={it.onClick}>
            <span>{it.label}</span><b>{it.value}</b>
          </Tag>
        );
      })}
    </div>
  );
}
