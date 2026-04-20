import { sendMessage, sleep } from '../linq/client.js';
import { searchBusinesses, type YelpBusiness } from '../yelp/client.js';
import { getPlaceData } from '../google/places.js';
import { filterRelevant } from '../ai/validate.js';
import { generateEveningPlan } from '../ai/plan.js';

// ── Haversine distance between two coordinates (km) ──────────────────────────

function distKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function walkLabel(km: number): string {
  if (km < 0.2) return '2 min walk';
  if (km < 0.5) return '5 min walk';
  if (km < 1.0) return `${Math.round(km * 10)} min walk`;
  return `${km.toFixed(1)}km`;
}

// ── Fetch best match for a search term ───────────────────────────────────────

async function fetchBest(term: string, location: string): Promise<YelpBusiness | null> {
  try {
    const pool = await searchBusinesses(term, location, { limit: 5, sort_by: 'best_match' } as Parameters<typeof searchBusinesses>[2]);
    const filtered = await filterRelevant(term, pool);
    return filtered[0] ?? pool[0] ?? null;
  } catch {
    return null;
  }
}

// ── Format one itinerary stop ─────────────────────────────────────────────────

function stopLabel(emoji: string, label: string, biz: YelpBusiness, summary: string | null, walkFrom?: string): string {
  const price = biz.price ?? '';
  const category = biz.categories[0]?.title ?? '';
  const isOpen = biz.business_hours?.[0]?.is_open_now;
  const openBadge = isOpen === true ? '🟢' : isOpen === false ? '🔴' : '';
  const lines = [
    `${emoji} ${label}${walkFrom ? `  (${walkFrom})` : ''}`,
    `${biz.name}  ⭐${biz.rating} ${price}  •  ${category} ${openBadge}`.trim(),
    biz.location.address1,
  ];
  if (summary) lines.push(`"${summary}"`);
  return lines.join('\n');
}

// ── Main: plan and send evening itinerary ─────────────────────────────────────

export async function planEvening(
  chatId: string,
  message: string,
  city: string,
): Promise<void> {
  await sendMessage(chatId, {
    parts: [{ type: 'text', value: `Planning your evening... 🌆` }],
  });

  // Step 1: Gemini generates the 3-part plan
  const plan = await generateEveningPlan(message, city);
  const location = plan.neighborhood || city;

  // Step 2: 3 Yelp searches in parallel
  const [dinner, dessert, drinks] = await Promise.all([
    fetchBest(plan.dinner, location),
    fetchBest(plan.dessert, location),
    fetchBest(plan.drinks, location),
  ]);

  if (!dinner && !dessert && !drinks) {
    await sendMessage(chatId, {
      parts: [{ type: 'text', value: `Couldn't find enough spots in ${location} 😕 Try a different area.` }],
    });
    return;
  }

  // Step 3: Google data for all found spots in parallel
  const spots = [
    { biz: dinner, emoji: '🍽️', label: 'Dinner' },
    { biz: dessert, emoji: '🍦', label: 'Dessert' },
    { biz: drinks, emoji: '🍸', label: 'After' },
  ].filter((s): s is { biz: YelpBusiness; emoji: string; label: string } => s.biz !== null);

  const googleData = await Promise.all(
    spots.map((s) => getPlaceData(s.biz.name, s.biz.location.city).catch(() => ({ photoUrl: null, attributes: {}, summary: null }))),
  );

  // Step 4: Build itinerary message
  const stopLines: string[] = [];
  for (let i = 0; i < spots.length; i++) {
    const { biz, emoji, label } = spots[i];
    const { summary } = googleData[i];

    let walkFrom: string | undefined;
    if (i > 0) {
      const prev = spots[i - 1].biz;
      if (prev.coordinates && biz.coordinates) {
        const km = distKm(prev.coordinates, biz.coordinates);
        walkFrom = walkLabel(km);
      }
    }

    stopLines.push(stopLabel(emoji, label, biz, summary, walkFrom));
  }

  const itinerary = `Here's your evening in ${location} 🌆\n\n${stopLines.join('\n\n')}`;

  // Step 5: Send photos + itinerary
  for (const { biz } of spots) {
    const data = googleData[spots.findIndex((s) => s.biz.id === biz.id)];
    if (data.photoUrl) {
      await sendMessage(chatId, { parts: [{ type: 'media', url: data.photoUrl }] });
      await sleep(200);
    }
  }

  await sendMessage(chatId, {
    parts: [{ type: 'text', value: itinerary }],
    effect: { type: 'screen', name: 'sparkles' },
  });
}
