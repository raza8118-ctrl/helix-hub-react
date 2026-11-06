import { useState, useEffect } from 'react';
import SecureImage from '../../components/shared/SecureImage';
import { S } from '../../lib/supabase';
import { POST_VISIBILITY } from '../../lib/constants';
import { confirmDialog } from '../../components/shared/Dialog';
import { Button } from '../../components/ui';

export default function FeedMonitor() {
  const [posts, setPosts]     = useState([]);
  const [comments, setComments] = useState([]);
  const [search, setSearch]   = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [p, c] = await Promise.all([S.get('feed_posts'), S.get('feed_comments')]);
    setPosts((p ?? []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    setComments(c ?? []);
    setLoading(false);
  }

  async function toggleHide(post) {
    await S.update('feed_posts', { admin_hidden: !post.admin_hidden }, { id: post.id });
    await load();
  }

  async function deletePost(post) {
    if (!await confirmDialog({ title: 'Delete this post?', message: `The post by ${post.emp_name ?? post.emp_id} and its comments will be permanently deleted.`, tone: 'danger', confirmText: 'Delete' })) return;
    await S.del('feed_comments', { post_id: post.id });
    await S.del('feed_posts', { id: post.id });
    await load();
  }

  const filtered = posts.filter(p => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (p.emp_name ?? '').toLowerCase().includes(q) || (p.emp_id ?? '').toLowerCase().includes(q);
  });

  return (
    <div className="fg-page nb-page">
      {/* Filters + action (the page title is in the top bar) */}
      <div className="fg-bar">
        <div className="fg-filters">
          <input type="text" className="fg-search" placeholder="Search employee…" aria-label="Search employee" value={search} onChange={e => setSearch(e.target.value)} />
          <span className="fg-date">All Team Feed posts, regardless of visibility — {posts.length} total</span>
        </div>
        <div className="fg-actions">
          <Button size="sm" onClick={load}>↺ Refresh</Button>
        </div>
      </div>

      {loading && <div className="loading-row"><div className="spinner" /> Loading…</div>}

      {!loading && filtered.map(post => {
        const visLabel = POST_VISIBILITY.find(v => v.id === post.visibility)?.label ?? post.visibility;
        const postComments = comments.filter(c => c.post_id === post.id);
        return (
          <div key={post.id} className={`card fm-post${post.admin_hidden ? ' hidden-post' : ''}`}>
            <div className="fm-head">
              <div>
                <div className="bold fm-name">{post.emp_name ?? post.emp_id}</div>
                <div className="text-muted text-sm">
                  {post.emp_id} · {new Date(post.created_at).toLocaleString()} · {visLabel}
                  {post.admin_hidden && <span className="badge badge-red" style={{ marginLeft: 6 }}>Hidden</span>}
                  {post.shared_from_post_id && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Repost</span>}
                </div>
              </div>
              <div className="fg-row-actions">
                <Button size="xs" onClick={() => toggleHide(post)}>{post.admin_hidden ? 'Unhide' : 'Hide'}</Button>
                <Button size="xs" variant="danger" onClick={() => deletePost(post)}>Delete</Button>
              </div>
            </div>
            {post.content && <div className="fm-text">{post.content}</div>}
            {post.image_url && <SecureImage src={post.image_url} alt="" style={{ maxWidth: 300, borderRadius: 8, marginBottom: 8 }} />}
            {post.gif_url && <img src={post.gif_url} alt="" style={{ maxWidth: 300, borderRadius: 8, marginBottom: 8 }} />}
            {postComments.length > 0 && (
              <div className="text-muted text-sm">{postComments.length} comment{postComments.length === 1 ? '' : 's'}</div>
            )}
          </div>
        );
      })}

      {!loading && filtered.length === 0 && (
        <div className="card text-muted fg-empty">No posts found.</div>
      )}
    </div>
  );
}
