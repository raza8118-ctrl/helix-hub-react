/** SVG line chart with area fill. data = [{name, v}] or [{label, value}] */
export default function LineChart({ data = [], height = 160, color = 'var(--accent)', label = '' }) {
  // Support both {name, v} and legacy {label, value}
  const items = data.map(d => ({
    name: d.name ?? d.label ?? '',
    v: d.v ?? d.value ?? 0,
  }));

  if (items.length < 2) return (
    <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>
      Not enough data points
    </div>
  );

  const PAD_L = 36, PAD_R = 12, PAD_B = 28, PAD_T = 14;
  const W = 480;
  const plotH = height - PAD_B - PAD_T;
  const plotW = W - PAD_L - PAD_R;
  const max = Math.max(...items.map(d => d.v), 100);

  const xOf = i => PAD_L + (i / (items.length - 1)) * plotW;
  const yOf = v => PAD_T + plotH - (v / max) * plotH;

  const pts = items.map((d, i) => [xOf(i), yOf(d.v)]);
  const pathD = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaD = `${pathD} L${pts.at(-1)[0].toFixed(1)},${PAD_T + plotH} L${pts[0][0].toFixed(1)},${PAD_T + plotH} Z`;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width="100%" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none"
        style={{ display: 'block', minHeight: height }}>
        <defs>
          <linearGradient id="lc-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map(pct => {
          const y = yOf(pct);
          if (y < PAD_T - 4 || y > PAD_T + plotH + 4) return null;
          return (
            <g key={pct}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y}
                stroke="var(--border)" strokeWidth="0.7"
                strokeDasharray="3,3" strokeOpacity="0.6" />
              <text x={PAD_L - 4} y={y + 3.5} textAnchor="end" fontSize="9" fill="var(--text-muted)">{pct}</text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaD} fill="url(#lc-area)" />

        {/* Line */}
        <path d={pathD} stroke={color} strokeWidth="2.5" fill="none"
          strokeLinecap="round" strokeLinejoin="round" />

        {/* Dots + x-axis labels */}
        {pts.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="3.5" fill={color} stroke="var(--surface)" strokeWidth="1.5" />
            <text x={x} y={PAD_T + plotH + 16} textAnchor="middle" fontSize="8.5" fill="var(--text-muted)">
              {items[i].name}
            </text>
          </g>
        ))}

        {/* Optional label */}
        {label && (
          <text x={PAD_L + 4} y={PAD_T - 2} fontSize="9" fill={color} fontWeight="600">{label}</text>
        )}
      </svg>
    </div>
  );
}
