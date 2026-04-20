import { generate } from './gemini.js';

export interface FallbackSearch {
  term: string;
  location: string;
  reason: string;
}

export async function suggestFallback(term: string, location: string): Promise<FallbackSearch> {
  const prompt = `A restaurant search for "${term}" in "${location}" returned zero results. Suggest a widened fallback search.

Return ONLY valid JSON — no markdown, no explanation.

Schema:
{
  "term": string,
  "location": string,
  "reason": string
}

Rules:
- term: simplify or broaden (e.g. "vegan sushi" → "sushi", "gluten-free pizza" → "pizza")
- location: keep the same unless it's very specific (e.g. "downtown Manhattan" → "Manhattan")
- reason: a short, friendly message to show the user explaining the change (e.g. "No vegan sushi found nearby — showing all sushi instead 🍣")

Example:
term="vegan sushi", location="Topeka, KS" → {"term":"sushi","location":"Topeka, KS","reason":"No vegan sushi near Topeka — showing all sushi spots instead 🍣"}`;

  const raw = await generate(prompt);
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned) as FallbackSearch;
  } catch {
    return { term, location, reason: `No exact matches found — showing similar options nearby 🔍` };
  }
}
