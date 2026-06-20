import { GIPHY_API_KEY } from './constants';

/** Search Giphy for GIFs matching a query. Returns an array of { id, url, previewUrl }. */
export async function searchGifs(query, limit = 12) {
  if (!query?.trim()) return [];
  const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query.trim())}&limit=${limit}&rating=pg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Giphy search failed (${res.status})`);
  const json = await res.json();
  return (json.data ?? []).map(g => ({
    id: g.id,
    url: g.images?.original?.url,
    previewUrl: g.images?.fixed_width_small?.url ?? g.images?.original?.url,
  })).filter(g => g.url);
}
