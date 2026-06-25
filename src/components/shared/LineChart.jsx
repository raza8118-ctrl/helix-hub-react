import { useState } from 'react';

const PAD_L = 50, PAD_R = 28, PAD_B = 34, PAD_T = 28;
const VB_W  = 520;

function smoothPath(pts) {
  if (!pts.length) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const cx = ((x0 + x1) / 2).toFixed(1);
    d += ` C${cx},${y0.toFixed(1)} ${cx},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

/** SVG line chart. data = [{name, v}] or [{label, value}] */
export default function LineChart({ data = [], height = 200, color = 'var(--accent)', label = '', title = '' }) {
  const [hov, setHov] = useState(-1);

  const items = data.map(d => ({
    name: d.name ?? d.label ?? '',
    v:    d.v    ?? d.value ?? 0,
  }));

  if (items.length < 2) return (
    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>
      Not enough data
    </div>
  );

  const plotH = height - PAD_B - PAD_T;
  const plotW = VB_W - PAD_L - PAD_R;
  const maxV  = Math.max(...items.map(d => d.v), 100);
  const xOf   = i => PAD_L + (i / (items.length - 1)) * plotW;
  const yOf   = v => PAD_T + plotH - (Math.min(v, maxV) / maxV) * plotH;
  const pts   = items.map((d, i) => [xOf(i), yOf(d.v)]);

  const linePath = smoothPath(pts);
  const areaPath = linePath
    + ` L${pts.at(-1)[0].toFixed(1)},${(PAD_T + plotH).toFixed(1)}`
    + ` L${pts[0][0].toFixed(1)},${(PAD_T + plotH).toFixed(1)} Z`;

  const GRID   = [0, 25, 50, 75, 100];
  const safeId = (color + label).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 32);
  const avgV   = items.reduce((s, d) => s + d.v, 0) / items.length;

  return (
    <div style={{ overflowX: 'auto', overflowY: 'visible' }}>
      <svg
        width="100%" viewBox={`0 0 ${VB_W} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', minHeight: height, overflow: 'visible', fontFamily: 'inherit' }}
        onMouseLeave={() => setHov(-1)}
      >
        <defs>
          <linearGradient id={`lc-area-${safeId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity="0.3" />
            <stop offset="70%"  stopColor={color} stopOpacity="0.06" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`lc-stroke-${safeId}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor={color} stopOpacity="0.5" />
            <stop offset="40%"  stopColor={color} stopOpacity="1" />
            <stop offset="60%"  stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.5" />
          </linearGradient>
          <linearGradient id={`lc-plot-${safeId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--text)" stopOpacity="0.025" />
            <stop offset="100%" stopColor="var(--text)" stopOpacity="0.004" />
          </linearGradient>
          <filter id={`lc-glow-${safeId}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Plot area bg */}
        <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH}
          fill={`url(#lc-plot-${safeId})`} rx="6" />

        {/* Grid lines + Y labels */}
        {GRID.map(pct => {
          const y = yOf(pct);
          if (y < PAD_T - 2 || y > PAD_T + plotH + 2) return null;
          return (
            <g key={pct}>
              <line x1={PAD_L} y1={y} x2={VB_W - PAD_R} y2={y}
                stroke={pct === 100 ? '#ef4444' : 'var(--border)'}
                strokeWidth={pct === 100 ? 1.5 : 0.8}
                strokeDasharray={pct === 100 ? '6,4' : '4,4'}
                strokeOpacity={pct === 100 ? 0.6 : 0.42}
              />
              <text x={PAD_L - 7} y={y + 4} textAnchor="end" fontSize="10"
                fill="var(--text-muted)" fontWeight="500" opacity="0.85">
                {pct}%
              </text>
            </g>
          );
        })}

        {/* Target label */}
        {yOf(100) >= PAD_T && yOf(100) <= PAD_T + plotH && (
          <text x={VB_W - PAD_R + 4} y={yOf(100) + 4} fontSize="9"
            fill="#ef4444" opacity="0.75" fontWeight="700">Target</text>
        )}

        {/* Average dashed line */}
        {avgV > 0 && (
          <g>
            <line x1={PAD_L} y1={yOf(avgV)} x2={VB_W - PAD_R} y2={yOf(avgV)}
              stroke={color} strokeWidth="1" strokeDasharray="3,4" strokeOpacity="0.4" />
            <text x={PAD_L + 4} y={yOf(avgV) - 4} fontSize="9"
              fill={color} opacity="0.75" fontWeight="600">
              Avg {Math.round(avgV)}%
            </text>
          </g>
        )}

        {/* Axes */}
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + plotH}
          stroke="var(--border)" strokeWidth="1.2" opacity="0.5" />
        <line x1={PAD_L} y1={PAD_T + plotH} x2={VB_W - PAD_R} y2={PAD_T + plotH}
          stroke="var(--border)" strokeWidth="1.2" opacity="0.5" />

        {/* Area fill */}
        <path d={areaPath} fill={`url(#lc-area-${safeId})`} />

        {/* Glow line behind */}
        <path d={linePath} stroke={color} strokeWidth="6" fill="none"
          strokeLinecap="round" strokeLinejoin="round"
          opacity="0.18" filter={`url(#lc-glow-${safeId})`} />

        {/* Main line */}
        <path d={linePath} stroke={`url(#lc-stroke-${safeId})`} strokeWidth="2.8" fill="none"
          strokeLinecap="round" strokeLinejoin="round" />

        {/* Hover vertical rule */}
        {hov >= 0 && (
          <line x1={pts[hov][0]} y1={PAD_T} x2={pts[hov][0]} y2={PAD_T + plotH}
            stroke={color} strokeWidth="1" strokeDasharray="4,3" opacity="0.35" />
        )}

        {/* Dots, labels, tooltip */}
        {pts.map(([x, y], i) => {
          const isH = hov === i;
          const d   = items[i];
          return (
            <g key={i} onMouseEnter={() => setHov(i)} style={{ cursor: 'default' }}>
              {/* Invisible wide hit target */}
              <rect x={x - 14} y={PAD_T} width={28} height={plotH} fill="transparent" />

              {/* Hover rings */}
              {isH && <circle cx={x} cy={y} r="11" fill={color} fillOpacity="0.12" />}
              {isH && <circle cx={x} cy={y} r="7"  fill={color} fillOpacity="0.2" />}

              {/* Dot */}
              <circle cx={x} cy={y} r={isH ? 5.5 : 3.8}
                fill={color} stroke="var(--surface)" strokeWidth="2.5"
                style={{ transition: 'r 0.12s' }} />

              {/* X label */}
              <text x={x} y={PAD_T + plotH + 18} textAnchor="middle"
                fontSize={isH ? '10.5' : '9.5'} fontWeight={isH ? '700' : '400'}
                fill={isH ? 'var(--text)' : 'var(--text-muted)'}
                style={{ transition: 'font-size 0.1s' }}>
                {d.name}
              </text>
              {/* Tick */}
              <line x1={x} y1={PAD_T + plotH} x2={x} y2={PAD_T + plotH + 5}
                stroke="var(--border)" strokeWidth="1" opacity="0.5" />

              {/* SVG tooltip */}
              {isH && (() => {
                const ttW = 90, ttH = 48;
                const ttX = Math.min(Math.max(x - ttW / 2, PAD_L), VB_W - PAD_R - ttW);
                const ttY = Math.max(y - ttH - 12, 2);
                return (
                  <g style={{ pointerEvents: 'none' }}>
                    <rect x={ttX} y={ttY} width={ttW} height={ttH} rx="8"
                      fill="var(--surface)" stroke={color} strokeWidth="1.2"
                      style={{ filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.22))' }} />
                    <text x={ttX + ttW / 2} y={ttY + 17} textAnchor="middle"
                      fontSize="10" fontWeight="600" fill="var(--text-muted)">{d.name}</text>
                    <text x={ttX + ttW / 2} y={ttY + 36} textAnchor="middle"
                      fontSize="15" fontWeight="800" fill={color}>{Math.round(d.v)}%</text>
                  </g>
                );
              })()}
            </g>
          );
        })}

        {/* Series label / title */}
        {(label || title) && (
          <text x={PAD_L + 4} y={PAD_T - 10} fontSize="11" fontWeight="700"
            fill={label ? color : 'var(--text-muted)'} opacity="0.9">
            {label || title}
          </text>
        )}
      </svg>
    </div>
  );
}
