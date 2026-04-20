import { sendMessage, startTyping, sleep } from '../linq/client.js';
import type { YelpBusiness } from '../yelp/client.js';
import type { PlaceAttributes } from '../google/places.js';
import { trackMessage } from './state.js';

const ATTR_BADGES: Record<string, string> = {
  outdoorSeating:       '🏕️ Outdoor',
  servesWine:           '🍷 Wine',
  servesBeer:           '🍺 Beer',
  servesCocktails:      '🍸 Cocktails',
  servesVegetarianFood: '🌿 Vegetarian',
  reservable:           '📅 Reservable',
  delivery:             '🛵 Delivery',
  takeout:              '🥡 takeout',
  liveMusic:            '🎵 Live music',
  goodForGroups:        '👥 Groups',
};

function attributeBadges(attrs: PlaceAttributes): string {
  return Object.entries(ATTR_BADGES)
    .filter(([key]) => attrs[key as keyof PlaceAttributes] === true)
    .map(([, badge]) => badge)
    .join('  ');
}

export async function sendWelcome(chatId: string): Promise<void> {
  await startTyping(chatId);
  await sleep(800);
  await sendMessage(chatId, {
    parts: [{ type: 'text', value: "What are you craving? 🍽️ (e.g. sushi, pizza, tacos)" }],
  });
}

export async function sendAskLocation(chatId: string, cuisine: string): Promise<void> {
  await startTyping(chatId);
  await sleep(600);
  await sendMessage(chatId, {
    parts: [{ type: 'text', value: `Which city? 📍 (searching for "${cuisine}")` }],
  });
}

export function formatCard(index: number, biz: YelpBusiness, attrs?: PlaceAttributes, summary?: string | null): string {
  const price = biz.price ?? '';
  const category = biz.categories[0]?.title ?? '';
  const address = biz.location.address1;
  const isOpen = biz.business_hours?.[0]?.is_open_now;
  const openBadge = isOpen === true ? '🟢 Open' : isOpen === false ? '🔴 Closed' : '';
  const distKm = biz.distance ? ` · ${(biz.distance / 1000).toFixed(1)}km` : '';
  const badges = attrs ? attributeBadges(attrs) : '';

  const lines = [
    `${index}. ${biz.name}`,
    `⭐${biz.rating} ${price}  •  ${category}${openBadge ? '  •  ' + openBadge : ''}`,
    `${address}${distKm}`,
  ];
  if (badges) lines.push(badges);
  if (summary) lines.push(`"${summary}"`);
  return lines.join('\n');
}

export async function sendResults(
  chatId: string,
  businesses: YelpBusiness[],
  photoUrls: (string | null)[] = [],
  placeAttrs: (PlaceAttributes | undefined)[] = [],
  summaries: (string | null | undefined)[] = [],
): Promise<void> {
  if (businesses.length === 0) {
    await sendMessage(chatId, {
      parts: [{ type: 'text', value: "No results found nearby 😕 Try rephrasing or a different city." }],
    });
    return;
  }

  for (let i = 0; i < businesses.length; i++) {
    const biz = businesses[i];
    const photo = photoUrls[i] ?? null;
    const attrs = placeAttrs[i];
    const summary = summaries[i] ?? null;

    if (photo) {
      await sendMessage(chatId, { parts: [{ type: 'media', url: photo }] });
      await sleep(200);
    }

    const card = formatCard(i + 1, biz, attrs, summary);
    const msg = await sendMessage(chatId, { parts: [{ type: 'text', value: card }] });
    trackMessage(msg.id, biz);
    if (i < businesses.length - 1) await sleep(300);
  }

  await sleep(300);
  await sendMessage(chatId, {
    parts: [{ type: 'text', value: `React ❤️ or reply 1, 2, or 3 to save 📌` }],
  });
}

export async function sendSaved(chatId: string, saved: YelpBusiness[]): Promise<void> {
  if (saved.length === 0) {
    await sendMessage(chatId, {
      parts: [{ type: 'text', value: "No saved spots yet — text \"food\" to search 🍽️" }],
    });
    return;
  }

  const lines = saved.map((b, i) => {
    const price = b.price ?? '';
    return `${i + 1}. ${b.name} ${price}  ⭐${b.rating}\n   ${b.location.address1}, ${b.location.city}`;
  });

  await sendMessage(chatId, {
    parts: [{ type: 'text', value: `📍 Your saved spots:\n\n${lines.join('\n\n')}` }],
  });
}
