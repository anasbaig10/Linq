import { generate } from './gemini.js';
import type { YelpBusiness } from '../yelp/client.js';

export async function estimateCrowd(biz: YelpBusiness, now: Date): Promise<string> {
  const day = now.toLocaleDateString('en-US', { weekday: 'long' });
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const category = biz.categories[0]?.title ?? 'restaurant';
  const price = biz.price ?? '';

  const prompt = `You are a local dining expert. Based on general knowledge, estimate how busy "${biz.name}" (${category}${price ? ', ' + price : ''}, ⭐${biz.rating}) typically is on a ${day} at ${time}.

Reply with ONE short sentence only. Start with an emoji: 🟢 (quiet), 🟡 (moderate), or 🔴 (very busy). Be specific and practical. Example: "🟡 Usually busy on Friday evenings — book ahead or arrive before 6pm."`;

  try {
    const raw = await generate(prompt);
    return raw.trim();
  } catch {
    return '';
  }
}
