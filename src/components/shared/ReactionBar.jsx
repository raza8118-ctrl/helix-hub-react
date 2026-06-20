import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';
import { REACTIONS } from '../../lib/constants';
import EmojiPicker from './EmojiPicker';

/** Self-contained reaction summary + picker for any target (post, feedback, etc). */
export default function ReactionBar({ targetType, targetId, user }) {
  const [reactions, setReactions] = useState([]);

  useEffect(() => { load(); }, [targetType, targetId]);

  async function load() {
    const rows = await S.get('feed_reactions', { target_type: targetType, target_id: targetId });
    setReactions(rows ?? []);
  }

  const myReaction = reactions.find(r => r.emp_id === user.emp_id)?.emoji ?? null;
  const counts = {};
  reactions.forEach(r => { counts[r.emoji] = (counts[r.emoji] ?? 0) + 1; });

  async function react(emojiId) {
    if (emojiId == null) {
      await S.del('feed_reactions', { target_type: targetType, target_id: targetId, emp_id: user.emp_id });
    } else {
      await S.set('feed_reactions', { target_type: targetType, target_id: targetId, emp_id: user.emp_id, emoji: emojiId }, ['target_type', 'target_id', 'emp_id']);
    }
    await load();
  }

  return (
    <div>
      {Object.keys(counts).length > 0 && (
        <div className="text-muted text-sm" style={{ marginBottom: 6 }}>
          {REACTIONS.filter(r => counts[r.id]).map(r => `${r.emoji}${counts[r.id]}`).join('  ')}
        </div>
      )}
      <EmojiPicker myReaction={myReaction} onReact={react} />
    </div>
  );
}
