import { generate } from './gemini.js';

export interface FoodIntent {
  is_food_query: boolean;
  term: string;
  location: string | null;
  price: string | null;
  open_now: boolean;
  specific_dish: boolean;
  attributes: string[];
  is_evening_plan: boolean; // "plan my night", "plan an evening", "night out"
}

const SYSTEM = `You are a food intent parser for an iMessage restaurant bot.
Given a user message, extract their restaurant search intent as JSON.

Return ONLY valid JSON — no markdown, no explanation.

Schema:
{
  "is_food_query": boolean,
  "term": string,
  "location": string | null,
  "price": "$" | "$$" | "$$$" | "$$$$" | null,
  "open_now": boolean,
  "specific_dish": boolean,
  "attributes": string[],
  "is_evening_plan": boolean
}

Rules:
- is_food_query: true only if they want to find food/restaurants
- term: preserve the EXACT dish or food item when specific. For vibe/occasion queries, pick the most fitting Yelp search term based on ALL context:
    "date night" / "first date" → use context: if casual/fun implied → "dessert", "ice cream", "cocktail bar"; if no context → "date spot"
    "business dinner" / "client dinner" → "upscale restaurant"
    "birthday dinner" → "fine dining"
    "brunch spot" → "brunch"
  Do NOT default to "romantic restaurant" or assume drinks/wine unless explicitly mentioned.
  Default to "restaurants" only if completely vague.
- location: extract city/neighborhood if mentioned, otherwise null
- price: map budget to Yelp price tiers:
    "$" (under ~$15/person): "cheap", "budget", "affordable", "inexpensive", "under $15", "under $20", "under 20 dollars", "under 15"
    "$$" (~$15–$30/person): "mid", "moderate", "around $20", "around $25", "under $30", "under $35", "under 30"
    "$$$" (~$30–$60/person): "upscale", "nice", "around $40", "under $50", "under $60", "a bit fancy"
    "$$$$" (over $60/person): "fancy", "fine dining", "splurge", "special occasion", "over $60", "expensive"
    null: if no price signal mentioned
- open_now: true if they say "tonight", "now", "open now", "right now", "today"
- specific_dish: true if searching for a specific dish (not just a broad cuisine)
- is_evening_plan: true if they want a full evening itinerary — dinner + dessert + drinks. Triggers on: "plan my evening", "plan a night out", "plan my night", "night out", "full evening", "plan my friday night", "plan a [anything] date night", "plan a [anything] evening", "plan an evening"
- attributes: ONLY add a tag if the user explicitly mentions it. Never infer attributes from vibe words like "date night", "romantic", "fun", "chill". Tags:
    "outdoor_seating"    — user says: patio, outside, al fresco, rooftop, outdoor
    "serves_wine"        — user says: wine bar, wine list, glass of wine
    "serves_beer"        — user says: beer, craft beer, brewery
    "serves_cocktails"   — user says: cocktails, drinks, bar
    "serves_vegetarian"  — user says: vegan, vegetarian, plant-based
    "reservable"         — user says: reservation, book a table, reserve
    "delivery"           — user says: delivery, deliver
    "takeout"            — user says: takeout, take out, pick up, to go
    "live_music"         — user says: live music, band, jazz, live performance
    "good_for_groups"    — user says: group, party, large group, team dinner
  Default to [] if not explicitly mentioned.

Examples:
"find me good sushi in boston" → {"is_food_query":true,"term":"sushi","location":"Boston","price":null,"open_now":false,"specific_dish":false,"attributes":[]}
"vegan place with outdoor seating open now" → {"is_food_query":true,"term":"restaurants","location":null,"price":null,"open_now":true,"specific_dish":false,"attributes":["outdoor_seating","serves_vegetarian"]}
"somewhere romantic with wine and live music in NYC" → {"is_food_query":true,"term":"restaurants","location":"New York","price":null,"open_now":false,"specific_dish":false,"attributes":["serves_wine","live_music"]}
"ube croissant near me" → {"is_food_query":true,"term":"ube croissant","location":null,"price":null,"open_now":false,"specific_dish":true,"attributes":[]}
"cheap tacos with delivery tonight" → {"is_food_query":true,"term":"tacos","location":null,"price":"$","open_now":true,"specific_dish":false,"attributes":["delivery"]}
"halal food under 20 dollars" → {"is_food_query":true,"term":"halal food","location":null,"price":"$","open_now":false,"specific_dish":false,"attributes":[]}
"sushi around $30 in Seattle" → {"is_food_query":true,"term":"sushi","location":"Seattle","price":"$$","open_now":false,"specific_dish":false,"attributes":[]}
"nice dinner under $50 in Manhattan" → {"is_food_query":true,"term":"restaurants","location":"Manhattan","price":"$$$","open_now":false,"specific_dish":false,"attributes":[]}
"good spot for a group dinner with cocktails" → {"is_food_query":true,"term":"restaurants","location":null,"price":null,"open_now":false,"specific_dish":false,"attributes":["good_for_groups","serves_cocktails"]}
"plan a night out in Back Bay" → {"is_food_query":true,"term":"restaurants","location":"Back Bay Boston","price":null,"open_now":false,"specific_dish":false,"attributes":[],"is_evening_plan":true}
"plan my friday evening in the South End" → {"is_food_query":true,"term":"restaurants","location":"South End Boston","price":null,"open_now":false,"specific_dish":false,"attributes":[],"is_evening_plan":true}
"best date night spot for first date" → {"is_food_query":true,"term":"date spot","location":null,"price":null,"open_now":false,"specific_dish":false,"attributes":[],"is_evening_plan":false}
"plan a halal food date night" → {"is_food_query":true,"term":"halal restaurant","location":null,"price":null,"open_now":false,"specific_dish":false,"attributes":[],"is_evening_plan":true}
"plan a fun date night in Brooklyn" → {"is_food_query":true,"term":"restaurants","location":"Brooklyn","price":null,"open_now":false,"specific_dish":false,"attributes":[],"is_evening_plan":true}
"plan a vegan date night" → {"is_food_query":true,"term":"vegan restaurant","location":null,"price":null,"open_now":false,"specific_dish":false,"attributes":["serves_vegetarian"],"is_evening_plan":true}
"fun first date idea, maybe ice cream or dessert" → {"is_food_query":true,"term":"dessert","location":null,"price":null,"open_now":false,"specific_dish":false,"attributes":[]}
"romantic dinner with wine for anniversary" → {"is_food_query":true,"term":"romantic restaurant","location":null,"price":"$$$","open_now":false,"specific_dish":false,"attributes":["serves_wine","reservable"]}
"fancy place for a business dinner in chicago" → {"is_food_query":true,"term":"upscale restaurant","location":"Chicago","price":"$$$","open_now":false,"specific_dish":false,"attributes":["reservable","good_for_groups"]}
"what time is it" → {"is_food_query":false,"term":"","location":null,"price":null,"open_now":false,"specific_dish":false,"attributes":[]}`;

export async function parseIntent(message: string): Promise<FoodIntent> {
  const raw = await generate(`${SYSTEM}\n\nUser message: "${message}"`);

  // strip any accidental markdown fences
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned) as FoodIntent;
  } catch {
    return {
      is_food_query: true,
      term: message,
      location: null,
      price: null,
      open_now: false,
      specific_dish: false,
      attributes: [],
      is_evening_plan: false,
    };
  }
}
