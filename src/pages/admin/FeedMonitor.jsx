import { useState, useEffect } from 'react';
import { S } from '../../lib/supabase';
import { POST_VISIBILITY } from '../../lib/constants';

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
    if (!window.confirm(`Permanently delete this post by ${post.emp_name ?? post.emp_id}?`)) return;
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
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Feed Monitor</div>
          <div className="page-subtitle">All Team Feed posts, regardless of visibility — {posts.length} total</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input type="text" placeholder="Search employee…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 180 }} />
          <button className="btn-sm" onClick={load}>↺ Refresh</button>
        </div>
      </div>

      {loading && <div className="loading-row"><div className="spinner" /> Loading…</div>}

      {!loading && filtered.map(post => {
        const visLabel = POST_VISIBILITY.find(v => v.id === post.visibility)?.label ?? post.visibility;
        const postComments = comments.filter(c => c.post_id === post.id);
        return (
          <div key={post.id} className="card" style={{ marginBottom: 12, opacity: post.admin_hidden ? 0.55 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div className="bold" style={{ fontSize: 13 }}>{post.emp_name ?? post.emp_id}</div>
                <div className="text-muted text-sm">
                  {post.emp_id} · {new Date(post.created_at).toLocaleString()} · {visLabel}
                  {post.admin_hidden && <span className="badge badge-red" style={{ marginLeft: 6 }}>Hidden</span>}
                  {post.shared_from_post_id && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Repost</span>}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn-sm" onClick={() => toggleHide(post)}>{post.admin_hidden ? 'Unhide' : 'Hide'}</button>
                <button className="btn-sm" style={{ color: 'var(--danger)' }} onClick={() => deletePost(post)}>Delete</button>
              </div>
            </div>
            {post.content && <div style={{ fontSize: 14, marginBottom: 8, whiteSpace: 'pre-wrap' }}>{post.content}</div>}
            {post.image_url && <img src={post.image_url} alt="" style={{ maxWidth: 300, borderRadius: 8, marginBottom: 8 }} />}
            {post.gif_url && <img src={post.gif_url} alt="" style={{ maxWidth: 300, borderRadius: 8, marginBottom: 8 }} />}
            {postComments.length > 0 && (
              <div className="text-muted text-sm">{postComments.length} comment{postComments.length === 1 ? '' : 's'}</div>
            )}
          </div>
        );
      })}

      {!loading && filtered.length === 0 && (
        <div className="text-muted text-sm">No posts found.</div>
      )}
    </div>
  );
}
