/**
 * Pill tabs (the Team Dashboard's Day / Week / Month switch).
 * <Tabs value={tab} onChange={setTab} options={[{ value: 'lookup', label: '🔎 Look up' }, …]} />
 */
export default function Tabs({ value, onChange, options, label }) {
  return (
    <div className="ui-tabs" role="tablist" aria-label={label}>
      {options.filter(Boolean).map(o => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} disabled={o.disabled}
          className={value === o.value ? 'on' : undefined} onClick={() => onChange(o.value)} title={o.title}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
