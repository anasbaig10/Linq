import { generate } from './gemini.js';
import type { YelpBusiness } from '../yelp/client.js';

/**
 * Filters out businesses that clearly don't match the search term.
 * E.g. "halal chinese" should not return Thai or Korean restaurants.
 * Returns the filtered list — if all pass, original list is returned unchanged.
 */
// Price tier ordering for budget enforcement
const PRICE_ORDER: Record<string, number> = { '$': 1, '$$': 2, '$$$': 3, '$$$$': 4 };

function priceTooExpensive(bizPrice: string | undefined, maxPrice: string | null): boolean {
  if (!maxPrice || !bizPrice) return false;
  return (PRICE_ORDER[bizPrice] ?? 0) > (PRICE_ORDER[maxPrice] ?? 99);
}

export async function filterRelevant(
  term: string,
  businesses: YelpBusiness[],
  maxPrice?: string | null,
): Promise<YelpBusiness[]> {
  if (businesses.length === 0) return businesses;

  // Hard-filter by price BEFORE sending to Gemini
  const withinBudget = maxPrice
    ? businesses.filter((b) => !priceTooExpensive(b.price, maxPrice))
    : businesses;

  if (withinBudget.length === 0) return [];

  const list = withinBudget
    .map((b, i) => {
      const cats = b.categories.map((c) => c.title).join(', ');
      const priceTag = b.price ? ` ${b.price}` : '';
      return `${i + 1}. ${b.name} (${cats}${priceTag})`;
    })
    .join('\n');

  const prompt = `A user searched for: "${term}"

These restaurants were returned:
${list}

Your job: filter out any restaurant that CLEARLY does not match the search intent.

Rules:
- If the search includes "halal", only keep restaurants that are very likely halal (Middle Eastern, Pakistani, Bangladeshi, halal BBQ, halal chicken, etc.). Exclude Thai, Chinese, Italian, Mexican, etc. unless their name or categories explicitly indicate halal.
- If the search includes a specific cuisine (e.g. "chinese", "mexican"), exclude restaurants of a completely different cuisine.
- If the search includes a dish (e.g. "ramen", "tacos"), exclude restaurants that clearly don't serve it.
- When in doubt, EXCLUDE rather than include.

Reply with ONLY the matching numbers separated by commas. Example: "1,3" or "2" or "1,2,3".
If none match, reply with "NONE".`;

  try {
    const raw = await generate(prompt);
    const trimmed = raw.trim();

    if (trimmed === 'NONE') return [];

    const indices = trimmed
      .split(',')
      .map((s) => parseInt(s.trim(), 10) - 1)
      .filter((i) => i >= 0 && i < businesses.length);

    // If Gemini kept at least one, return filtered list
    if (indices.length > 0) {
      return indices.map((i) => businesses[i]);
    }

    // Parse failed — return empty so fallback search kicks in
    return [];
  } catch {
    return businesses;
  }
}
