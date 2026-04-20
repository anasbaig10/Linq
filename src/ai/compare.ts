import { generate } from './gemini.js';
import type { YelpBusiness } from '../yelp/client.js';

export async function compareSaved(question: string, saved: YelpBusiness[]): Promise<string> {
  const list = saved
    .map((b, i) => {
      const cat = b.categories[0]?.title ?? 'restaurant';
      return `${i + 1}. ${b.name} — ${cat}, ${b.price ?? ''} ⭐${b.rating}, ${b.location.city}`;
    })
    .join('\n');

  const prompt = `The user has these saved restaurants:
${list}

User question: "${question}"

If this question is clearly about comparing or picking from their saved spots (e.g. "best for a date", "cheapest option", "what's good for lunch"), answer with 1-2 sentences recommending the best fit and why.

If the question has nothing to do with their saved restaurants, reply with exactly: NOT_ABOUT_SAVED

Reply with the recommendation or NOT_ABOUT_SAVED — nothing else.`;

  try {
    const raw = await generate(prompt);
    const trimmed = raw.trim();
    if (trimmed === 'NOT_ABOUT_SAVED') return '';
    return trimmed;
  } catch {
    return '';
  }
}
