import { Component } from 'react';

const RELOAD_KEY = 'hh_chunk_reload';
// A page's code file is gone because a newer version was deployed while Helix Hub was open
const isStaleChunk = err => /dynamically imported module|Importing a module script failed|Failed to fetch dynamically|ChunkLoadError|Loading chunk/i.test(String(err?.message ?? err));

/**
 * Catches a crash inside one page so the rest of Helix Hub (sidebar, top bar) keeps working: shows the error with a
 * Reload button instead of a black screen. When the crash is a stale code file after a new deploy, it reloads once
 * automatically (at most once a minute, so it can never loop).
 */
export default class PageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    if (!isStaleChunk(error)) return;
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOAD_KEY) || 0); } catch { /* storage blocked */ }
    if (Date.now() - last > 60000) {
      try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage blocked */ }
      window.location.reload();
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isStaleChunk(error);
    return (
      <div className="card" style={{ maxWidth: 640, margin: '40px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 32 }}>⚠️</div>
        <div className="bold" style={{ fontSize: 17, margin: '6px 0' }}>
          {stale ? 'Helix Hub was updated — please reload' : 'This page ran into a problem'}
        </div>
        <p className="text-sm text-muted">
          {stale
            ? 'A newer version was published while this page was open.'
            : 'The rest of Helix Hub still works — pick another page in the sidebar, or reload. If it keeps happening, send this message to your admin:'}
        </p>
        {!stale && (
          <pre className="text-sm" style={{ whiteSpace: 'pre-wrap', textAlign: 'left', background: 'var(--surface-2, rgba(127,127,127,0.1))', padding: 10, borderRadius: 8 }}>
            {String(error?.message ?? error)}
          </pre>
        )}
        <button className="btn-primary" onClick={() => window.location.reload()}>↻ Reload</button>
      </div>
    );
  }
}
