/**
 * OpenTable integration — search, availability, and booking link generation.
 * Uses OpenTable's public-facing search page (HTML parse) + widget availability endpoint.
 */

export interface OTRestaurant {
  rid: number;
  name: string;
  slug: string;
}

export interface TimeSlot {
  time: string;       // "7:00 PM"
  datetime: string;   // ISO "2026-04-19T19:00"
}

const OT_BASE = 'https://www.opentable.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Find a restaurant on OpenTable by name + city.
 * Fetches the OT search page and parses __NEXT_DATA__ for the first match.
 */
export async function findOnOpenTable(
  name: string,
  city: string,
): Promise<OTRestaurant | null> {
  const term = encodeURIComponent(`${name} ${city}`);
  const url = `${OT_BASE}/s?term=${term}&covers=2&dateTime=${todayAt7pm()}&lang=en-US`;

  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    const html = await res.text();

    // OpenTable embeds all page data in a <script id="__NEXT_DATA__"> JSON blob
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) return null;

    const data = JSON.parse(match[1]);

    // Walk the nested structure — restaurants live under different paths depending on version
    const restaurants: any[] =
      data?.props?.pageProps?.initialState?.search?.restaurants ??
      data?.props?.pageProps?.restaurants ??
      data?.props?.pageProps?.searchResults?.restaurants ??
      [];

    if (!restaurants.length) return null;

    // Find the closest name match (case-insensitive)
    const lower = name.toLowerCase();
    const best = restaurants.find((r: any) =>
      (r.name ?? r.restaurantName ?? '').toLowerCase().includes(lower),
    ) ?? restaurants[0];

    const rid = best?.rid ?? best?.restaurantId ?? best?.id;
    const slug = best?.urlSlug ?? best?.slug ?? String(rid);
    const foundName = best?.name ?? best?.restaurantName ?? name;

    if (!rid) return null;
    return { rid: Number(rid), name: foundName, slug };
  } catch {
    return null;
  }
}

// ── Availability ───────────────────────────────────────────────────────────────

/**
 * Returns available time slots for a given restaurant, date, and party size.
 * Uses OpenTable's widget availability API.
 */
export async function getAvailability(
  rid: number,
  isoDatetime: string,   // "2026-04-19T19:00"
  covers: number,
): Promise<TimeSlot[]> {
  const dt = new Date(isoDatetime);
  const month = dt.getMonth() + 1;
  const day = dt.getDate();
  const year = dt.getFullYear();
  const timeStr = formatTime24(dt);   // "19:00"

  const url =
    `${OT_BASE}/widget/reservation/availability` +
    `?rid=${rid}&party_size=${covers}&month=${month}&day=${day}&year=${year}&time=${timeStr}&lang=en-US`;

  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    const html = await res.text();

    // The widget returns HTML with time buttons — parse them out
    // <a ... data-time="19:00" ...>7:00 PM</a>  or  data-datetime="2026-04-19T19:00"
    const slots: TimeSlot[] = [];

    // Pattern 1: data-datetime attribute
    const pattern1 = /data-datetime="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = pattern1.exec(html)) !== null) {
      const iso = m[1];
      slots.push({ datetime: iso, time: formatDisplayTime(iso) });
    }

    if (slots.length > 0) return dedupeSlots(slots);

    // Pattern 2: data-time attribute
    const pattern2 = /data-time="(\d{2}:\d{2})"/g;
    while ((m = pattern2.exec(html)) !== null) {
      const [h, min] = m[1].split(':').map(Number);
      const slotDt = new Date(dt);
      slotDt.setHours(h, min, 0, 0);
      const iso = toISOLocal(slotDt);
      slots.push({ datetime: iso, time: formatDisplayTime(iso) });
    }

    return dedupeSlots(slots);
  } catch {
    return [];
  }
}

// ── Booking URL ────────────────────────────────────────────────────────────────

/**
 * Builds a pre-filled OpenTable reservation URL.
 * User taps it → lands directly on the confirmation step.
 */
export function buildBookingUrl(rid: number, isoDatetime: string, covers: number): string {
  return (
    `${OT_BASE}/restaurant/profile/${rid}/reserve` +
    `?covers=${covers}&datetime=${encodeURIComponent(isoDatetime)}&ref=`
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayAt7pm(): string {
  const d = new Date();
  d.setHours(19, 0, 0, 0);
  return toISOLocal(d).replace('T', '%3A').replace(/T/, 'T');
}

function formatTime24(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDisplayTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}:00 ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function toISOLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dedupeSlots(slots: TimeSlot[]): TimeSlot[] {
  const seen = new Set<string>();
  return slots.filter((s) => {
    if (seen.has(s.datetime)) return false;
    seen.add(s.datetime);
    return true;
  });
}
