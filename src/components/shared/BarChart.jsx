import { useState } from 'react';

const BAR_W = 46, GAP = 12, PAD_L = 50, PAD_R = 24, PAD_B = 44, PAD_T = 28;
const MAX_PCT = 130;

function barColor(prod, mode, color) {
  if (mode === 'value') return { a: color, b: color, glow: color };
  if (prod >= 100) return { a: '#4ade80', b: '#16a34a', glow: '#22c55e' };
  if (prod >= 85)  return { a: '#fcd34d', b: '#ca8a04', glow: '#eab308' };
  if (prod >= 70)  return { a: '#fb923c', b: '#c2410c', glow: '#f97316' };
  return               { a: '#f87171', b: '#b91c1c', glow: '#ef4444' };
}

function smoothLine(pts) {
  if (!pts.length) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const cx = ((x0 + x1) / 2).toFixed(1);
    d += ` C${cx},${y0.toFixed(1)} ${cx},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

/**
 * SVG bar chart. data = [{name, prod}] or [{label, value}]. onBarClick(item, index) fires on click.
 * mode='percent' (default) keeps the 0-130% productivity scale with a 100% target line.
 * mode='value' switches to a dynamic scale for raw numbers (e.g. call counts), single-color bars, no target line.
 */
export default function BarChart({ data = [], height = 220, showLine = false, title = '', onBarClick, mode = 'percent', color = 'var(--accent)', suffix }) {
  const [hov, setHov] = useState(-1);
  const sfx = suffix ?? (mode === 'percent' ? '%' : '');

  const items = data.map(d => ({
    ...d,
    name: d.name ?? d.label ?? '',
    prod: d.prod ?? d.value ?? 0,
  }));

  if (!items.length) return (
    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>
      No data available
    </div>
  );

  const scaleMax = mode === 'value'
    ? Math.max(...items.map(d => d.prod), 1) * 1.2
    : MAX_PCT;

  const totalW = Math.max(items.length * (BAR_W + GAP) + PAD_L + PAD_R + GAP, 340);
  const plotH  = height - PAD_B - PAD_T;
  const yOf    = v => PAD_T + plotH - Math.max(0, (Math.min(v, scaleMax) / scaleMax) * plotH);

  const GRID = mode === 'value'
    ? [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(scaleMax * f))
    : [0, 25, 50, 75, 100];
  const avg  = items.reduce((s, d) => s + d.prod, 0) / items.length;

  return (
    <div style={{ overflowX: 'auto', overflowY: 'visible' }}>
      <svg
        width={totalW} height={height}
        viewBox={`0 0 ${totalW} ${height}`}
        style={{ display: 'block', overflow: 'visible', fontFamily: 'inherit' }}
        onMouseLeave={() => setHov(-1)}
      >
        <defs>
          {items.map((d, i) => {
            const c = barColor(d.prod, mode, color);
            return (
              <linearGradient key={i} id={`bc-bar-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={c.a} stopOpacity="1" />
                <stop offset="100%" stopColor={c.b} stopOpacity="0.85" />
              </linearGradient>
            );
          })}
          <linearGradient id="bc-plot" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--text)" stopOpacity="0.03" />
            <stop offset="100%" stopColor="var(--text)" stopOpacity="0.005" />
          </linearGradient>
          <linearGradient id="bc-avg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="var(--accent)" stopOpacity="0" />
            <stop offset="20%"  stopColor="var(--accent)" stopOpacity="0.6" />
            <stop offset="80%"  stopColor="var(--accent)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Plot area bg */}
        <rect x={PAD_L} y={PAD_T} width={totalW - PAD_L - PAD_R} height={plotH}
          fill="url(#bc-plot)" rx="6" />

        {/* Grid lines */}
        {GRID.map(pct => {
          const y = yOf(pct);
          const is100 = mode === 'percent' && pct === 100;
          return (
            <g key={pct}>
              <line x1={PAD_L} y1={y} x2={totalW - PAD_R} y2={y}
                stroke={is100 ? '#ef4444' : 'var(--border)'}
                strokeWidth={is100 ? 1.5 : 0.8}
                strokeDasharray={is100 ? '6,4' : '4,4'}
                strokeOpacity={is100 ? 0.6 : 0.45}
              />
              <text x={PAD_L - 7} y={y + 4} textAnchor="end" fontSize="10"
                fill="var(--text-muted)" fontWeight="500" opacity="0.85">
                {pct}{sfx}
              </text>
            </g>
          );
        })}

        {/* Target label */}
        {mode === 'percent' && (
          <text x={totalW - PAD_R + 4} y={yOf(100) + 4} fontSize="9"
            fill="#ef4444" opacity="0.75" fontWeight="700">Target</text>
        )}

        {/* Average line */}
        {items.length > 1 && (
          <g>
            <line x1={PAD_L} y1={yOf(avg)} x2={totalW - PAD_R} y2={yOf(avg)}
              stroke="url(#bc-avg)" strokeWidth="1.2" strokeDasharray="3,3" />
            <text x={PAD_L + 4} y={yOf(avg) - 4} fontSize="9"
              fill="var(--accent)" opacity="0.8" fontWeight="600">
              Avg {Math.round(avg)}{sfx}
            </text>
          </g>
        )}

        {/* Axes */}
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + plotH}
          stroke="var(--border)" strokeWidth="1.2" opacity="0.5" />
        <line x1={PAD_L} y1={PAD_T + plotH} x2={totalW - PAD_R} y2={PAD_T + plotH}
          stroke="var(--border)" strokeWidth="1.2" opacity="0.5" />

        {/* Bars */}
        {items.map((d, i) => {
          const barH = Math.max((Math.min(d.prod, scaleMax) / scaleMax) * plotH, 2);
          const x    = PAD_L + GAP + i * (BAR_W + GAP);
          const y    = PAD_T + plotH - barH;
          const c    = barColor(d.prod, mode, color);
          const isH  = hov === i;
          const dim  = hov >= 0 && !isH;

          return (
            <g key={i} onMouseEnter={() => setHov(i)}
              onClick={() => onBarClick?.(d, i)}
              style={{ cursor: onBarClick ? 'pointer' : 'default' }}>
              {/* Column hover bg */}
              {isH && (
                <rect x={x - 4} y={PAD_T} width={BAR_W + 8} height={plotH}
                  fill={c.glow} fillOpacity="0.09" rx="5" />
              )}
              {/* Glow under bar */}
              {isH && (
                <ellipse cx={x + BAR_W / 2} cy={PAD_T + plotH - 3} rx={BAR_W / 2 + 2} ry={5}
                  fill={c.glow} fillOpacity="0.35" />
              )}
              {/* Bar body */}
              <rect x={x} y={y} width={BAR_W} height={barH}
                fill={`url(#bc-bar-${i})`} rx="5" ry="5"
                opacity={dim ? 0.45 : 1}
                style={{ transition: 'opacity 0.15s' }}
              />
              {/* Flat bottom to cancel rounded corners at base */}
              {barH > 10 && (
                <rect x={x} y={y + barH - 6} width={BAR_W} height={6}
                  fill={`url(#bc-bar-${i})`}
                  opacity={dim ? 0.45 : 1}
                  style={{ transition: 'opacity 0.15s' }}
                />
              )}
              {/* Shine strip */}
              {!dim && barH > 20 && (
                <rect x={x + 5} y={y + 4} width={8} height={Math.min(barH - 10, 28)}
                  fill="white" fillOpacity="0.12" rx="4" />
              )}
              {/* Value label */}
              {d.prod > 0 && (
                <text x={x + BAR_W / 2} y={Math.max(y - 6, PAD_T + 10)} textAnchor="middle"
                  fontSize={isH ? '12' : '10'} fontWeight="700"
                  fill={isH ? c.a : 'var(--text-muted)'}
                  style={{ transition: 'font-size 0.1s' }}>
                  {Math.round(d.prod)}{sfx}
                </text>
              )}
              {/* X label */}
              <text x={x + BAR_W / 2} y={PAD_T + plotH + 18} textAnchor="middle"
                fontSize="9.5" fontWeight={isH ? '700' : '400'}
                fill={isH ? 'var(--text)' : 'var(--text-muted)'}>
                {d.name.length > 8 ? d.name.slice(0, 7) + '…' : d.name}
              </text>
              {/* Tick mark */}
              <line x1={x + BAR_W / 2} y1={PAD_T + plotH} x2={x + BAR_W / 2} y2={PAD_T + plotH + 5}
                stroke="var(--border)" strokeWidth="1" opacity="0.5" />

              {/* SVG tooltip */}
              {isH && (() => {
                const ttW = 90, ttH = 48;
                const ttX = Math.min(Math.max(x + BAR_W / 2 - ttW / 2, PAD_L), totalW - PAD_R - ttW);
                const ttY = Math.max(y - ttH - 10, 2);
                return (
                  <g style={{ pointerEvents: 'none' }}>
                    <rect x={ttX} y={ttY} width={ttW} height={ttH} rx="8"
                      fill="var(--surface)" stroke={c.a} strokeWidth="1.2"
                      style={{ filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.22))' }} />
                    <text x={ttX + ttW / 2} y={ttY + 17} textAnchor="middle"
                      fontSize="10" fontWeight="600" fill="var(--text-muted)">{d.name}</text>
                    <text x={ttX + ttW / 2} y={ttY + 36} textAnchor="middle"
                      fontSize="15" fontWeight="800" fill={c.a}>{Math.round(d.prod)}{sfx}</text>
                  </g>
                );
              })()}
            </g>
          );
        })}

        {/* Line overlay */}
        {showLine && items.length > 1 && (() => {
          const pts = items.map((d, i) => [
            PAD_L + GAP + i * (BAR_W + GAP) + BAR_W / 2,
            yOf(d.prod),
          ]);
          const d = smoothLine(pts);
          return (
            <g>
              <path d={d} stroke="var(--accent)" strokeWidth="2.8" fill="none"
                strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
              {pts.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={hov === i ? 5.5 : 4}
                  fill="var(--accent)" stroke="var(--surface)" strokeWidth="2.5"
                  style={{ transition: 'r 0.1s' }} />
              ))}
            </g>
          );
        })()}

        {/* Chart title */}
        {title && (
          <text x={PAD_L} y={PAD_T - 12} fontSize="11" fontWeight="600"
            fill="var(--text-muted)">{title}</text>
        )}
      </svg>
    </div>
  );
}
