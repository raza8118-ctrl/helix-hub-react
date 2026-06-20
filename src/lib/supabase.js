import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_ANTHROPIC_KEY,
  { db: { schema: 'rcm' } }
);

// General-purpose table helper — used by all pages
export const S = {
  async get(table, filters = {}) {
    let q = supabase.from(table).select('*');
    for (const [col, val] of Object.entries(filters)) {
      if (Array.isArray(val)) q = q.in(col, val);
      else q = q.eq(col, val);
    }
    const { data, error } = await q;
    if (error) { console.error('S.get error', error); return null; }
    return data;
  },

  async getOne(table, filters = {}) {
    const rows = await S.get(table, filters);
    return rows?.[0] ?? null;
  },

  async set(table, payload, matchCols = null) {
    let q;
    if (matchCols) {
      q = supabase.from(table).upsert(payload, {
        onConflict: Array.isArray(matchCols) ? matchCols.join(',') : matchCols,
      });
    } else {
      q = supabase.from(table).insert(payload);
    }
    const { data, error } = await q.select();
    if (error) { console.error('S.set error', error); return null; }
    return data;
  },

  async del(table, filters = {}) {
    let q = supabase.from(table).delete();
    for (const [col, val] of Object.entries(filters)) {
      q = q.eq(col, val);
    }
    const { error } = await q;
    if (error) { console.error('S.del error', error); return null; }
    return true;
  },

  async update(table, payload, filters = {}) {
    let q = supabase.from(table).update(payload);
    for (const [col, val] of Object.entries(filters)) {
      q = q.eq(col, val);
    }
    const { data, error } = await q.select();
    if (error) { console.error('S.update error', error); return null; }
    return data;
  },
};

// File uploads — Supabase Storage
export const storage = {
  async uploadFile(bucket, path, file) {
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
    if (error) { console.error('storage.uploadFile error', error); return null; }
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data?.publicUrl ?? null;
  },
};

// Key-value store backed by rcm_store table { key TEXT PK, value JSONB }
export const kv = {
  async get(key) {
    const { data, error } = await supabase
      .from('rcm_store')
      .select('value')
      .eq('key', key)
      .single();
    if (error) return null;
    return data?.value ?? null;
  },

  async set(key, value) {
    const { error } = await supabase
      .from('rcm_store')
      .upsert({ key, value }, { onConflict: 'key' });
    if (error) { console.error('kv.set error', error); return false; }
    return true;
  },
};
