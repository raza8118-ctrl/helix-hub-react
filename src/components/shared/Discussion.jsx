import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';
import ReactionBar from './ReactionBar';
import CommentThread from './CommentThread';

/**
 * Collapsed reaction/comment counts that expand into the full reaction bar +
 * comment thread on click. Keeps a feed/announcement card from reading as an
 * always-open live-chat thread — the discussion only shows once asked for.
 */
export default function Discussion({ targetType, targetId, user }) {
  const [open, setOpen] = useState(false);
  const [reactionCount, setReactionCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);

  useEffect(() => { loadCounts(); }, [targetType, targetId]);

  async function loadCounts() {
    const [r, c] = await Promise.all([
      S.get('feed_reactions', { target_type: targetType, target_id: targetId }),
      S.get('feed_comments', { target_type: targetType, post_id: targetId }),
    ]);
    setReactionCount(r?.length ?? 0);
    setCommentCount(c?.length ?? 0);
  }

  function toggle() {
    if (open) loadCounts(); // refresh counts in case something changed while expanded
    setOpen(v => !v);
  }

  return (
    <div onClick={e => e.stopPropagation()}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={toggle}
        style={{ color: 'var(--text-muted)' }}
      >
        👍 {reactionCount} · 💬 {commentCount} {open ? '▲' : '▾'}
      </button>
      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
          <ReactionBar targetType={targetType} targetId={targetId} user={user} />
          <div className="text-muted text-sm bold" style={{ marginTop: 10, marginBottom: 4 }}>Comments</div>
          <CommentThread targetType={targetType} targetId={targetId} user={user} />
        </div>
      )}
    </div>
  );
}
