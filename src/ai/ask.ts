import { generate } from './gemini.js';
import type { YelpBusiness } from '../yelp/client.js';

export async function answerAboutResults(question: string, results: YelpBusiness[]): Promise<string> {
  const list = results
    .map((b, i) => {
      const cat = b.categories[0]?.title ?? 'restaurant';
      const isOpen = b.business_hours?.[0]?.is_open_now;
      const openStr = isOpen === true ? 'open' : isOpen === false ? 'closed' : 'unknown hours';
      const dist = b.distance ? `${(b.distance / 1000).toFixed(1)}km away` : '';
      return `${i + 1}. ${b.name} — ${cat}, ${b.price ?? ''} ⭐${b.rating}, ${openStr}${dist ? ', ' + dist : ''}`;
    })
    .join('\n');

  const prompt = `You are a restaurant concierge assistant inside iMessage. The user is looking at these search results:
${list}

User question: "${question}"

Answer their question about these specific restaurants in 1-2 short sentences. Be direct and helpful.
If the question has nothing to do with these restaurants, reply with exactly: UNRELATED`;

  try {
    const raw = await generate(prompt);
    const trimmed = raw.trim();
    if (trimmed === 'UNRELATED') return '';
    return trimmed;
  } catch {
    return '';
  }
}
