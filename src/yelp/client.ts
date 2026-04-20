const YELP_API_BASE = 'https://api.yelp.com/v3';
const API_KEY = process.env.YELP_API_KEY ?? '';

export interface YelpBusiness {
  id: string;
  name: string;
  rating: number;
  price?: string;
  phone: string;
  url: string;
  categories: { title: string }[];
  location: { address1: string; city: string };
  business_hours?: { is_open_now: boolean }[];
  distance?: number; // metres
  coordinates?: { latitude: number; longitude: number };
}

export interface YelpSearchOptions {
  limit?: number;
  price?: string | null;
  open_now?: boolean;
  radius?: number; // metres, max 40000
  offset?: number;
}

interface YelpSearchResponse {
  businesses: YelpBusiness[];
}

async function yelpFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${YELP_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Yelp API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

function priceToParam(price: string): string {
  const map: Record<string, string> = { '$': '1', '$$': '2', '$$$': '3', '$$$$': '4' };
  return map[price] ?? '1,2,3,4';
}

export async function searchBusinesses(
  term: string,
  location: string,
  opts: YelpSearchOptions = {},
): Promise<YelpBusiness[]> {
  const params: Record<string, string> = {
    term,
    location,
    limit: String(opts.limit ?? 3),
    sort_by: 'best_match',
    radius: String(opts.radius ?? 5000), // default 5km
  };

  if (opts.price) params.price = priceToParam(opts.price);
  if (opts.open_now) params.open_now = 'true';
  if (opts.offset) params.offset = String(opts.offset);

  const data = await yelpFetch<YelpSearchResponse>('/businesses/search', params);
  return data.businesses;
}
