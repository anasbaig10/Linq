import { generate } from './gemini.js';
import type { LastSearch } from '../restaurant/state.js';

export interface RefinedSearch {
  is_refinement: boolean;
  term: string;
  location: string;
  price: string | null;
  open_now: boolean;
}

export async function refineSearch(message: string, last: LastSearch): Promise<RefinedSearch> {
  const prompt = `You are a restaurant search assistant. A user just sent a follow-up message. Determine if it refines their previous search or starts a completely new one.

Previous search: term="${last.term}", location="${last.location}", price="${last.price ?? 'any'}", open_now=${last.open_now}

Follow-up message: "${message}"

Return ONLY valid JSON — no markdown, no explanation.

Schema:
{
  "is_refinement": boolean,
  "term": string,
  "location": string,
  "price": "$" | "$$" | "$$$" | "$$$$" | null,
  "open_now": boolean
}

Rules:
- is_refinement: true if the message adjusts the previous search (different price, different neighborhood, open now, etc.)
- If refinement, inherit unchanged fields from the previous search
- If not a refinement, use the new message values and set location to "" if not mentioned
- price: "cheaper"/"budget" → "$", "fancier"/"upscale" → "$$$$", inherit previous if not changed
- open_now: inherit previous unless explicitly changed

Examples:
Previous: term="ramen", location="Boston", price="$$", open_now=false
"actually cheaper" → {"is_refinement":true,"term":"ramen","location":"Boston","price":"$","open_now":false}
"make it open now" → {"is_refinement":true,"term":"ramen","location":"Boston","price":"$$","open_now":true}
"find me pizza in NYC" → {"is_refinement":false,"term":"pizza","location":"NYC","price":null,"open_now":false}`;

  const raw = await generate(prompt);
  const cleaned = raw.replace(/\`\`\`json|\`\`\`/g, '').trim();

  try {
    return JSON.parse(cleaned) as RefinedSearch;
  } catch {
    return { is_refinement: false, term: message, location: '', price: null, open_now: false };
  }
}
