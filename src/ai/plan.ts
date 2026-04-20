import { generate } from './gemini.js';

export interface EveningPlan {
  dinner: string;   // Yelp search term
  dessert: string;
  drinks: string;
  neighborhood: string; // resolved from message or fallback city
}

export async function generateEveningPlan(
  message: string,
  fallbackCity: string,
): Promise<EveningPlan> {
  const prompt = `You are a nightlife planner. Based on this request, generate a 3-part evening plan.

User request: "${message}"
Fallback city: "${fallbackCity}"

Return ONLY valid JSON — no markdown, no explanation.

Schema:
{
  "dinner": string,
  "dessert": string,
  "drinks": string,
  "neighborhood": string
}

Rules:
- dinner: Yelp search term for the dinner spot (e.g. "Italian restaurant", "sushi", "steakhouse")
- dessert: Yelp search term for dessert (e.g. "dessert bar", "ice cream", "pastry shop", "gelato")
- drinks: Yelp search term for after-dinner drinks (e.g. "cocktail bar", "wine bar", "rooftop bar", "jazz club")
- neighborhood: extract specific neighborhood/area from message if mentioned, otherwise use fallbackCity
- Match the vibe: casual request → casual picks, fancy request → upscale picks

Examples:
"plan a fun friday night in Back Bay" → {"dinner":"casual restaurant","dessert":"dessert bar","drinks":"cocktail bar","neighborhood":"Back Bay Boston"}
"romantic evening in the South End" → {"dinner":"romantic restaurant","drinks":"wine bar","dessert":"chocolate fondue","neighborhood":"South End Boston"}
"chill night out in NYC" → {"dinner":"bistro","dessert":"ice cream","drinks":"rooftop bar","neighborhood":"New York City"}`;

  const raw = await generate(prompt);
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned) as EveningPlan;
  } catch {
    return {
      dinner: 'restaurant',
      dessert: 'dessert',
      drinks: 'bar',
      neighborhood: fallbackCity,
    };
  }
}
