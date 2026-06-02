/** SVG bar chart. data = [{name, prod}] or [{label, value}] */
export default function BarChart({ data = [], height = 160, showLine = false }) {
  // Support both {name, prod} and legacy {label, value}
  const items = data.map(d => ({
    name: d.name ?? d.label ?? '',
    prod: d.prod ?? d.value ?? 0,
  }));

  if (!items.length) return (
    <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 13 }}>
      No data available
    </div>
  );

  const BAR_W = 36, GAP = 8, PAD_L = 38, PAD_R = 12, PAD_B = 32;
  const totalW = Math.max(items.length * (BAR_W + GAP) + PAD_L + PAD_R, 300);
  const plotH = height - PAD_B;
  const MAX = 120; // allow bars to go above 100%

  // y position for a value (0-MAX)
  const yOf = v => plotH - Math.max(0, (Math.min(v, MAX) / MAX) * (plotH - 12));

  // Gradient color stops per prod value
  const gradStops = prod => {
    if (prod >= 100) return ['#34d399', '#10b981'];
    if (prod >= 85)  return ['#fbbf24', '#f59e0b'];
    if (prod >= 70)  return ['#fb923c', '#f97316'];
    return ['#f87171', '#ef4444'];
  };

  const linePoints = items.map((d, i) => {
    const cx = PAD_L + i * (BAR_W + GAP) + BAR_W / 2;
    const cy = yOf(d.prod);
    return `${cx.toFixed(1)},${cy.toFixed(1)}`;
  });

  return (
    <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
      <svg width={totalW} height={height} viewBox={`0 0 ${totalW} ${height}`}>
        <defs>
          {items.map((d, i) => {
            const [top, bot] = gradStops(d.prod);
            return (
              <linearGradient key={i} id={`bg${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={top} stopOpacity="0.95" />
                <stop offset="100%" stopColor={bot} stopOpacity="0.75" />
              </linearGradient>
            );
          })}
        </defs>

        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map(pct => {
          const y = yOf(pct);
          const is100 = pct === 100;
          return (
            <g key={pct}>
              <line
                x1={PAD_L} y1={y} x2={totalW - PAD_R} y2={y}
                stroke={is100 ? '#ef4444' : 'var(--border)'}
                strokeWidth={is100 ? 1.3 : 0.7}
                strokeDasharray={is100 ? '5,3' : '3,3'}
                strokeOpacity={is100 ? 0.75 : 0.55}
              />
              <text x={PAD_L - 4} y={y + 3.5} textAnchor="end" fontSize="9" fill="var(--text-muted)" opacity="0.8">
                {pct}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {items.map((d, i) => {
          const x = PAD_L + i * (BAR_W + GAP);
          const barH = Math.max((Math.min(d.prod, MAX) / MAX) * (plotH - 12), 2);
          const y = plotH - barH;
          return (
            <g key={i}>
              <rect x={x} y={y} width={BAR_W} height={barH} fill={`url(#bg${i})`} rx="3" ry="3" />
              {d.prod > 0 && (
                <text x={x + BAR_W / 2} y={y - 4} textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontWeight="600">
                  {Math.round(d.prod)}%
                </text>
              )}
              <text x={x + BAR_W / 2} y={height - 8} textAnchor="middle" fontSize="8.5" fill="var(--text-muted)">
                {d.name.length > 6 ? d.name.slice(0, 5) + '…' : d.name}
              </text>
            </g>
          );
        })}

        {/* Line overlay */}
        {showLine && items.length > 1 && (
          <>
            <polyline
              points={linePoints.join(' ')}
              stroke="var(--accent)"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {items.map((_, i) => {
              const [x, y] = linePoints[i].split(',').map(Number);
              return <circle key={i} cx={x} cy={y} r="3" fill="var(--accent)" />;
            })}
          </>
        )}
      </svg>
    </div>
  );
}
