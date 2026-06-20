import { useState, useEffect } from 'react';
import { S, storage } from '../../lib/supabase';
import { canViewPost, resizeImage } from '../../lib/helpers';
import { POST_VISIBILITY, FEED_BUCKET } from '../../lib/constants';
import { searchGifs } from '../../lib/giphy';
import FriendsPanel from '../../components/shared/FriendsPanel';
import ReactionBar from '../../components/shared/ReactionBar';
import CommentThread from '../../components/shared/CommentThread';

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Defined at module scope (not inside TeamFeed) so React keeps a stable identity
// across re-renders — otherwise every post (and any open EmojiPicker popover)
// would unmount/remount on every unrelated state change in the parent.
function PostCard({ post, user, userById, posts, openComments, setOpenComments, sharePost, deletePost }) {
  const author = userById(post.emp_id);
  const shared = post.shared_from_post_id ? posts.find(p => p.id === post.shared_from_post_id) : null;
  const sharedAuthor = shared ? userById(shared.emp_id) : null;
  const visLabel = POST_VISIBILITY.find(v => v.id === post.visibility)?.label ?? post.visibility;

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div className="bold" style={{ fontSize: 13 }}>{author?.name ?? post.emp_id}</div>
          <div className="text-muted text-sm">{timeAgo(post.created_at)} · {visLabel}</div>
        </div>
        {post.emp_id === user.emp_id && (
          <button className="btn-sm" style={{ color: 'var(--danger)' }} onClick={() => deletePost(post)}>Delete</button>
        )}
      </div>

      {shared && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 8, background: 'var(--surface-2)' }}>
          <div className="text-sm bold" style={{ marginBottom: 4 }}>{sharedAuthor?.name ?? shared.emp_id}</div>
          {shared.content && <div style={{ fontSize: 13, marginBottom: 6 }}>{shared.content}</div>}
          {shared.image_url && <img src={shared.image_url} alt="" style={{ maxWidth: '100%', borderRadius: 6 }} />}
          {shared.gif_url && <img src={shared.gif_url} alt="" style={{ maxWidth: '100%', borderRadius: 6 }} />}
        </div>
      )}

      {post.content && <div style={{ fontSize: 14, marginBottom: 8, whiteSpace: 'pre-wrap' }}>{post.content}</div>}
      {post.image_url && <img src={post.image_url} alt="" style={{ maxWidth: '100%', borderRadius: 8, marginBottom: 8 }} />}
      {post.gif_url && <img src={post.gif_url} alt="" style={{ maxWidth: '100%', borderRadius: 8, marginBottom: 8 }} />}

      <ReactionBar targetType="post" targetId={post.id} user={user} />

      <div style={{ display: 'flex', gap: 8, marginTop: 8, marginBottom: 8 }}>
        <button className="btn-sm" onClick={() => setOpenComments(prev => ({ ...prev, [post.id]: !prev[post.id] }))}>
          💬 Comment
        </button>
        <button className="btn-sm" onClick={() => sharePost(post)}>🔁 Share</button>
      </div>

      {openComments[post.id] && <CommentThread targetType="post" targetId={post.id} user={user} />}
    </div>
  );
}

export default function TeamFeed({ user }) {
  const [allUsers, setAllUsers]   = useState([]);
  const [requests, setRequests]   = useState([]);
  const [closeFriends, setCloseFriends] = useState([]);
  const [posts, setPosts]         = useState([]);
  const [loading, setLoading]     = useState(false);
  const [showFriends, setShowFriends] = useState(false);

  const [content, setContent]     = useState('');
  const [visibility, setVisibility] = useState('public');
  const [imageUrl, setImageUrl]   = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const [gifQuery, setGifQuery]   = useState('');
  const [gifResults, setGifResults] = useState([]);
  const [gifUrl, setGifUrl]       = useState('');
  const [gifLoading, setGifLoading] = useState(false);
  const [gifErr, setGifErr]       = useState('');
  const [posting, setPosting]     = useState(false);

  const [openComments, setOpenComments] = useState({});

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [u, r, c, p] = await Promise.all([
      S.get('users'),
      S.get('friend_requests'),
      S.get('close_friends'),
      S.get('feed_posts'),
    ]);
    setAllUsers(u ?? []);
    setRequests(r ?? []);
    setCloseFriends((c ?? []).filter(x => x.owner_emp_id === user.emp_id));
    setPosts((p ?? []).filter(x => !x.admin_hidden));
    setLoading(false);
  }

  const userById = id => allUsers.find(u => u.emp_id === id);

  async function pickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setUploadErr('Please pick an image file.'); return; }
    setUploadErr(''); setUploading(true); setGifUrl(''); setGifResults([]);
    try {
      const blob = await resizeImage(file);
      const path = `${user.emp_id}/${Date.now()}.jpg`;
      const url = await storage.uploadFile(FEED_BUCKET, path, blob);
      if (!url) throw new Error('upload failed');
      setImageUrl(url);
    } catch {
      setUploadErr('Upload failed — make sure the "feed-media" Storage bucket exists and is public.');
    }
    setUploading(false);
  }

  async function doGifSearch() {
    if (!gifQuery.trim()) return;
    setGifLoading(true); setGifErr('');
    try {
      const results = await searchGifs(gifQuery);
      setGifResults(results);
      if (results.length === 0) setGifErr('No GIFs found for that search.');
    } catch (err) {
      setGifResults([]);
      setGifErr(`GIF search failed: ${err.message}`);
    }
    setGifLoading(false);
  }

  function pickGif(url) {
    setGifUrl(url);
    setImageUrl('');
    setGifResults([]);
  }

  async function submitPost() {
    if (!content.trim() && !imageUrl && !gifUrl) return;
    setPosting(true);
    await S.set('feed_posts', {
      emp_id: user.emp_id,
      emp_name: user.name ?? user.emp_id,
      content: content.trim() || null,
      image_url: imageUrl || null,
      gif_url: gifUrl || null,
      visibility,
      created_at: new Date().toISOString(),
    });
    setContent(''); setImageUrl(''); setGifUrl(''); setGifQuery(''); setGifResults([]);
    setPosting(false);
    await load();
  }

  async function deletePost(post) {
    if (post.emp_id !== user.emp_id) return;
    if (!window.confirm('Delete this post?')) return;
    await S.del('feed_posts', { id: post.id });
    await load();
  }

  async function sharePost(post) {
    await S.set('feed_posts', {
      emp_id: user.emp_id,
      emp_name: user.name ?? user.emp_id,
      content: null,
      image_url: null,
      gif_url: null,
      visibility: 'public',
      shared_from_post_id: post.shared_from_post_id ?? post.id,
      created_at: new Date().toISOString(),
    });
    await load();
  }

  const visiblePosts = posts
    .filter(p => canViewPost(p, user.emp_id, requests, closeFriends))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Team Feed</div>
          <div className="page-subtitle">Share updates, photos, and GIFs with your team</div>
        </div>
        <button className="btn-primary" onClick={() => setShowFriends(true)}>👥 Friends</button>
      </div>

      {/* Composer */}
      <div className="card" style={{ marginBottom: 16 }}>
        <textarea
          rows={3} value={content} onChange={e => setContent(e.target.value)}
          placeholder="Share an update or a quote…"
          style={{ width: '100%', resize: 'vertical', marginBottom: 10 }}
        />

        {imageUrl && (
          <div style={{ position: 'relative', marginBottom: 10, maxWidth: 240 }}>
            <img src={imageUrl} alt="" style={{ maxWidth: '100%', borderRadius: 8 }} />
            <button className="btn-sm" onClick={() => setImageUrl('')} style={{ position: 'absolute', top: 4, right: 4 }}>✕</button>
          </div>
        )}
        {gifUrl && (
          <div style={{ position: 'relative', marginBottom: 10, maxWidth: 240 }}>
            <img src={gifUrl} alt="" style={{ maxWidth: '100%', borderRadius: 8 }} />
            <button className="btn-sm" onClick={() => setGifUrl('')} style={{ position: 'absolute', top: 4, right: 4 }}>✕</button>
          </div>
        )}
        {uploadErr && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{uploadErr}</div>}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <label className="btn-sm" style={{ cursor: 'pointer' }}>
            📷 {uploading ? 'Uploading…' : 'Photo'}
            <input type="file" accept="image/*" onChange={pickImage} disabled={uploading} style={{ display: 'none' }} />
          </label>
          <input
            type="text" placeholder="Search GIFs… (press Enter)" value={gifQuery}
            onChange={e => setGifQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doGifSearch()}
            style={{ maxWidth: 180 }}
          />
          <button className="btn-sm" onClick={doGifSearch} disabled={gifLoading}>{gifLoading ? 'Searching…' : '🔍 GIF'}</button>
          <select value={visibility} onChange={e => setVisibility(e.target.value)} style={{ maxWidth: 150 }}>
            {POST_VISIBILITY.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
          <button className="btn-primary" onClick={submitPost} disabled={posting} style={{ marginLeft: 'auto' }}>
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>

        {gifErr && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{gifErr}</div>}

        {gifResults.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {gifResults.map(g => (
              <img key={g.id} src={g.previewUrl} alt="" onClick={() => pickGif(g.url)}
                style={{ width: '100%', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)' }} />
            ))}
          </div>
        )}
      </div>

      {/* Feed */}
      {loading ? (
        <div className="loading-row"><div className="spinner" /> Loading…</div>
      ) : visiblePosts.length === 0 ? (
        <div className="text-muted text-sm">No posts yet — be the first to share something.</div>
      ) : (
        visiblePosts.map(post => (
          <PostCard
            key={post.id} post={post} user={user} userById={userById} posts={posts}
            openComments={openComments} setOpenComments={setOpenComments}
            sharePost={sharePost} deletePost={deletePost}
          />
        ))
      )}

      {showFriends && <FriendsPanel user={user} onClose={() => setShowFriends(false)} />}
    </div>
  );
}
