import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';
import { REACTIONS } from '../../lib/constants';
import EmojiPicker from './EmojiPicker';

/** Self-contained reaction summary + picker for any target (post, feedback, etc). */
export default function ReactionBar({ targetType, targetId, user }) {
  const [reactions, setReactions] = useState([]);
  const [users, setUsers]         = useState([]);

  useEffect(() => { load(); }, [targetType, targetId]);

  async function load() {
    const [rows, u] = await Promise.all([
      S.get('feed_reactions', { target_type: targetType, target_id: targetId }),
      S.get('users'),
    ]);
    setReactions(rows ?? []);
    setUsers(u ?? []);
  }

  const nameOf = id => users.find(u => u.emp_id === id)?.name ?? id;
  const myReaction = reactions.find(r => r.emp_id === user.emp_id)?.emoji ?? null;

  async function react(emojiId) {
    if (emojiId == null) {
      await S.del('feed_reactions', { target_type: targetType, target_id: targetId, emp_id: user.emp_id });
    } else {
      await S.set('feed_reactions', { target_type: targetType, target_id: targetId, emp_id: user.emp_id, emoji: emojiId }, ['target_type', 'target_id', 'emp_id']);
    }
    await load();
  }

  const byEmoji = REACTIONS
    .map(r => ({ ...r, who: reactions.filter(x => x.emoji === r.id).map(x => nameOf(x.emp_id)) }))
    .filter(r => r.who.length > 0);

  return (
    <div>
      {byEmoji.length > 0 && (
        <div className="text-muted text-sm" style={{ marginBottom: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {byEmoji.map(r => (
            <span key={r.id} title={r.who.join(', ')} style={{ cursor: 'default' }}>
              {r.emoji} {r.who.length} — {r.who.join(', ')}
            </span>
          ))}
        </div>
      )}
      <EmojiPicker myReaction={myReaction} onReact={react} />
    </div>
  );
}
