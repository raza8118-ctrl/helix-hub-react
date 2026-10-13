// Twinkling starfield backdrop (styles in index.css → "Starfield").
// local: fills its positioned parent instead of the viewport.
// always: shows regardless of theme (e.g. the login brand panel).
export default function Starfield({ local = false, always = false }) {
  const cls = [local ? 'starfield-local' : 'starfield', always && 'always'].filter(Boolean).join(' ');
  return (
    <div className={cls} aria-hidden="true">
      <span className="sf-far" />
      <span className="sf-mid" />
      <span className="sf-near" />
    </div>
  );
}
