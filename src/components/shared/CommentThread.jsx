import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';

// feed_comments.post_id is reused as a generic target id (alongside target_type)
// rather than renamed, so existing Team Feed posts keep working unmigrated.
export default function CommentThread({ targetType, targetId, user }) {
  const [comments, setComments] = useState([]);
  const [draft, setDraft]       = useState('');
  const [loading, setLoading]   = useState(true);

  useEffect(() => { load(); }, [targetType, targetId]);

  async function load() {
    setLoading(true);
    const rows = await S.get('feed_comments', { target_type: targetType, post_id: targetId });
    setComments((rows ?? []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
    setLoading(false);
  }

  async function addComment() {
    const text = draft.trim();
    if (!text) return;
    await S.set('feed_comments', {
      target_type: targetType, post_id: targetId,
      emp_id: user.emp_id, emp_name: user.name ?? user.emp_id,
      content: text, created_at: new Date().toISOString(),
    });
    setDraft('');
    await load();
  }

  if (loading) return null;

  return (
    <div>
      {comments.map(c => (
        <div key={c.id} style={{ fontSize: 13, marginBottom: 4 }}>
          <strong>{c.emp_name ?? c.emp_id}:</strong> {c.content}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input
          type="text" placeholder="Write a comment…"
          value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addComment()}
          style={{ flex: 1 }}
        />
        <button className="btn-sm" onClick={addComment}>Post</button>
      </div>
    </div>
  );
}
