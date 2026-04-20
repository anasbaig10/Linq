const API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? '';
const BASE = 'https://places.googleapis.com/v1';

export interface GoogleReview {
  author: string;
  rating: number;
  text: string;
  relativeTime: string;
}

export interface PlaceAttributes {
  outdoorSeating?: boolean;
  servesBeer?: boolean;
  servesWine?: boolean;
  servesCocktails?: boolean;
  servesVegetarianFood?: boolean;
  reservable?: boolean;
  delivery?: boolean;
  takeout?: boolean;
  liveMusic?: boolean;
  goodForGroups?: boolean;
}

export interface PlaceDetails {
  review: GoogleReview | null;
  photoUrl: string | null;
}

export interface PlaceData {
  photoUrl: string | null;
  attributes: PlaceAttributes;
  summary: string | null;
}

// Fields to request in every searchText call
const EXTRA_FIELDS = 'places.editorialSummary';

const ATTR_FIELDS = [
  'places.outdoorSeating',
  'places.servesBeer',
  'places.servesWine',
  'places.servesCocktails',
  'places.servesVegetarianFood',
  'places.reservable',
  'places.delivery',
  'places.takeout',
  'places.liveMusic',
  'places.goodForGroups',
].join(',');

// ── Internal: find place (id + photo ref + attributes) in one call ─────────────

interface RawPlace {
  id: string;
  photoName: string | null;
  attributes: PlaceAttributes;
  summary: string | null;
}

async function findPlace(name: string, city: string): Promise<RawPlace | null> {
  const res = await fetch(`${BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': `places.id,places.photos,${EXTRA_FIELDS},${ATTR_FIELDS}`,
    },
    body: JSON.stringify({ textQuery: `${name} ${city}` }),
  });

  if (!res.ok) return null;

  const data = await res.json() as {
    places?: ({
      id: string;
      photos?: { name: string }[];
      editorialSummary?: { text: string };
    } & PlaceAttributes)[];
  };

  const p = data.places?.[0];
  if (!p) return null;

  return {
    id: p.id,
    photoName: p.photos?.[0]?.name ?? null,
    summary: p.editorialSummary?.text ?? null,
    attributes: {
      outdoorSeating: p.outdoorSeating,
      servesBeer: p.servesBeer,
      servesWine: p.servesWine,
      servesCocktails: p.servesCocktails,
      servesVegetarianFood: p.servesVegetarianFood,
      reservable: p.reservable,
      delivery: p.delivery,
      takeout: p.takeout,
      liveMusic: p.liveMusic,
      goodForGroups: p.goodForGroups,
    },
  };
}

// ── Internal: resolve photo reference → CDN URL ───────────────────────────────

async function resolvePhotoUrl(photoName: string): Promise<string | null> {
  const url = `${BASE}/${photoName}/media?maxHeightPx=800&maxWidthPx=800&skipHttpRedirect=true&key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json() as { photoUri?: string };
  return data.photoUri ?? null;
}

// ── Internal: fetch reviews ───────────────────────────────────────────────────

async function fetchReviews(placeId: string): Promise<GoogleReview[]> {
  const res = await fetch(`${BASE}/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'reviews',
    },
  });

  if (!res.ok) return [];

  const data = await res.json() as {
    reviews?: {
      rating: number;
      text?: { text: string };
      authorAttribution?: { displayName: string };
      relativePublishTimeDescription?: string;
    }[];
  };

  return (data.reviews ?? [])
    .filter((r) => r.text?.text)
    .map((r) => ({
      author: r.authorAttribution?.displayName ?? 'Anonymous',
      rating: r.rating,
      text: r.text!.text,
      relativeTime: r.relativePublishTimeDescription ?? '',
    }));
}

// ── Public: search restaurants (fallback when Yelp has no coverage) ──────────

import type { YelpBusiness } from '../yelp/client.js';

const PRICE_MAP: Record<string, string> = {
  PRICE_LEVEL_FREE:            '$',
  PRICE_LEVEL_INEXPENSIVE:     '$',
  PRICE_LEVEL_MODERATE:        '$$',
  PRICE_LEVEL_EXPENSIVE:       '$$$',
  PRICE_LEVEL_VERY_EXPENSIVE:  '$$$$',
};

export async function searchGooglePlaces(
  term: string,
  location: string,
  maxResults = 6,
): Promise<YelpBusiness[]> {
  const res = await fetch(`${BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.nationalPhoneNumber',
        'places.internationalPhoneNumber',
        'places.rating',
        'places.userRatingCount',
        'places.priceLevel',
        'places.primaryTypeDisplayName',
        'places.types',
        'places.businessStatus',
        'places.location',
        'places.googleMapsUri',
        'places.websiteUri',
      ].join(','),
    },
    body: JSON.stringify({
      textQuery: `${term} restaurants in ${location}`,
      maxResultCount: maxResults,
      languageCode: 'en',
    }),
  });

  if (!res.ok) return [];

  const data = await res.json() as {
    places?: {
      id: string;
      displayName?: { text: string };
      formattedAddress?: string;
      nationalPhoneNumber?: string;
      internationalPhoneNumber?: string;
      rating?: number;
      userRatingCount?: number;
      priceLevel?: string;
      primaryTypeDisplayName?: { text: string };
      types?: string[];
      businessStatus?: string;
      location?: { latitude: number; longitude: number };
      googleMapsUri?: string;
      websiteUri?: string;
    }[];
  };

  return (data.places ?? []).map((p) => {
    // Parse city from formattedAddress (last meaningful part before country)
    const addrParts = (p.formattedAddress ?? '').split(',').map((s) => s.trim());
    const city = addrParts.length >= 2 ? addrParts[addrParts.length - 2] : location;
    const address1 = addrParts[0] ?? '';

    const categoryTitle = p.primaryTypeDisplayName?.text
      ?? (p.types?.[0] ?? 'restaurant').replace(/_/g, ' ');

    const isClosed = p.businessStatus === 'CLOSED_PERMANENTLY' ||
                     p.businessStatus === 'CLOSED_TEMPORARILY';

    return {
      id: p.id,
      name: p.displayName?.text ?? 'Unknown',
      url: p.googleMapsUri ?? p.websiteUri ?? '',
      phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? '',
      rating: p.rating ?? 0,
      price: PRICE_MAP[p.priceLevel ?? ''] ?? undefined,
      categories: [{ title: categoryTitle }],
      location: { address1, city },
      coordinates: p.location,
    } satisfies YelpBusiness;
  });
}

// ── Public: photo + attributes for result cards ───────────────────────────────

export async function getPlaceData(name: string, city: string): Promise<PlaceData> {
  try {
    const place = await findPlace(name, city);
    if (!place) return { photoUrl: null, attributes: {}, summary: null };

    const photoUrl = place.photoName ? await resolvePhotoUrl(place.photoName) : null;
    return { photoUrl, attributes: place.attributes, summary: place.summary };
  } catch {
    return { photoUrl: null, attributes: {}, summary: null };
  }
}

// ── Public: review + photo for save confirmation ──────────────────────────────

export async function getPlaceDetails(name: string, city: string): Promise<PlaceDetails> {
  try {
    const place = await findPlace(name, city);
    if (!place) return { review: null, photoUrl: null };

    const [reviews, photoUrl] = await Promise.all([
      fetchReviews(place.id),
      place.photoName ? resolvePhotoUrl(place.photoName) : Promise.resolve(null),
    ]);

    const sorted = reviews
      .filter((r) => r.text.length > 30)
      .sort((a, b) => b.rating - a.rating);

    return { review: sorted[0] ?? reviews[0] ?? null, photoUrl };
  } catch {
    return { review: null, photoUrl: null };
  }
}
