'use client';

// Outcome chart, stacked bars. Data must come from fillSeries() in lib/derive.js.
export function StackedBars({ data, height = 140 }) {
  const w = 600;
  const keys = ['passthrough', 'healed', 'rejected', 'halted'];
  const color = { passthrough: 'var(--ok)', healed: 'var(--healed)', rejected: 'var(--rejected)', halted: 'var(--halted)' };
  const max = Math.max(1, ...data.map((d) => keys.reduce((n, k) => n + d[k], 0)));
  const bw = w / Math.max(1, data.length);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height} role="img" aria-label="Call outcomes over time">
      <line x1="0" x2={w} y1={height - 0.5} y2={height - 0.5} stroke="var(--border-strong)" />
      {data.map((d, i) => {
        let y = height;
        return keys.map((k) => {
          const h = (d[k] / max) * (height - 6);
          y -= h;
          return h > 0 ? <rect key={`${i}-${k}`} x={i * bw + 1} y={y} width={Math.max(1, bw - 2)} height={h} rx="1" fill={color[k]} /> : null;
        });
      })}
    </svg>
  );
}

export function Legend() {
  const items = [['ok', 'Passed'], ['healed', 'Healed'], ['rejected', 'Rejected'], ['halted', 'Halted']];
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      {items.map(([c, l]) => (
        <span key={c} className="flex items-center gap-1.5">
          <i style={{ width: 8, height: 8, borderRadius: 2, background: `var(--${c})`, display: 'inline-block' }} />
          {l}
        </span>
      ))}
    </div>
  );
}
