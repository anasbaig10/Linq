import { sendMessage, startTyping, sleep } from '../linq/client.js';
import type { YelpBusiness } from '../yelp/client.js';
import { searchBusinesses } from '../yelp/client.js';
import { parseIntent } from '../ai/intent.js';
import { refineSearch } from '../ai/refine.js';
import { suggestFallback } from '../ai/fallback.js';
import { compareSaved } from '../ai/compare.js';
import { estimateCrowd } from '../ai/crowd.js';
import { answerAboutResults } from '../ai/ask.js';
import { filterRelevant } from '../ai/validate.js';
import { parseBookingRequest } from '../ai/booking.js';
import { findOnOpenTable, getAvailability, buildBookingUrl } from '../booking/opentable.js';
import { getPlaceDetails, getPlaceData, searchGooglePlaces, type PlaceAttributes } from '../google/places.js';
import { planEvening } from './evening.js';
import {
  getOrCreateGroupSession,
  setGroupVoting,
  getVoteResults,
  resetGroupSession,
} from './group.js';
import {
  getSession,
  getOrCreateSession,
  setStep,
  setLastResults,
  setLastSearch,
  resetSession,
  saveRestaurant,
  resolveMessage,
  setBooking,
} from './state.js';
import { sendResults, sendSaved } from './browse.js';
import type { Subscriber } from '../state/store.js';

function cleanUrl(url: string): string {
  try { return new URL(url).origin + new URL(url).pathname; }
  catch { return url; }
}

// Attribute tag → PlaceAttributes key mapping (mirrors intent.ts tags)
const ATTR_KEY_MAP: Record<string, keyof PlaceAttributes> = {
  outdoor_seating:  'outdoorSeating',
  serves_wine:      'servesWine',
  serves_beer:      'servesBeer',
  serves_cocktails: 'servesCocktails',
  serves_vegetarian:'servesVegetarianFood',
  reservable:       'reservable',
  delivery:         'delivery',
  takeout:          'takeout',
  live_music:       'liveMusic',
  good_for_groups:  'goodForGroups',
};

interface PlaceDataWithBiz {
  biz: YelpBusiness;
  photoUrl: string | null;
  attributes: PlaceAttributes;
  summary: string | null;
}

async function fetchRelevant(
  term: string,
  location: string,
  opts: Parameters<typeof searchBusinesses>[2],
): Promise<{ businesses: YelpBusiness[]; source: 'yelp' | 'google' }> {
  // Try Yelp first
  try {
    const pool = await searchBusinesses(term, location, { ...opts, limit: 6 });
    const filtered = await filterRelevant(term, pool, opts?.price ?? null);
    if (filtered.length > 0) {
      return { businesses: filtered.slice(0, 3), source: 'yelp' };
    }
  } catch {
    // Yelp failed — fall through to Google
  }

  // Fallback: Google Places (global coverage)
  const pool = await searchGooglePlaces(term, location, 6).catch(() => []);
  const filtered = await filterRelevant(term, pool, opts?.price ?? null).catch(() => pool.slice(0, 3));
  return { businesses: filtered.slice(0, 3), source: 'google' };
}

async function fetchPlaceData(businesses: YelpBusiness[]): Promise<PlaceDataWithBiz[]> {
  return Promise.all(
    businesses.map((biz) =>
      getPlaceData(biz.name, biz.location.city)
        .catch(() => ({ photoUrl: null, attributes: {} as PlaceAttributes, summary: null }))
        .then((d) => ({ biz, ...d })),
    ),
  );
}

function sortByAttributes(data: PlaceDataWithBiz[], requested: string[]): PlaceDataWithBiz[] {
  if (!requested.length) return data;
  return data.slice().sort((a, b) => {
    const scoreA = requested.filter((tag) => {
      const key = ATTR_KEY_MAP[tag];
      return key && a.attributes[key] === true;
    }).length;
    const scoreB = requested.filter((tag) => {
      const key = ATTR_KEY_MAP[tag];
      return key && b.attributes[key] === true;
    }).length;
    return scoreB - scoreA;
  });
}

export function isInActiveSession(handle: string): boolean {
  const session = getSession(handle);
  return !!session && (session.step === 'awaiting_selection' || session.step === 'awaiting_location');
}

// ── Confirm save + crowd estimate ────────────────────────────────────────────

// Resolve a promise within ms, returning null on timeout or error
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((res) => setTimeout(() => res(null), ms)),
  ]);
}

async function confirmSave(chatId: string, biz: YelpBusiness): Promise<void> {
  const phone = biz.phone || 'no phone listed';

  // Fetch crowd estimate + Google details in parallel — each capped at 5s so save never hangs
  const [crowd, details] = await Promise.all([
    withTimeout(estimateCrowd(biz, new Date()), 5000),
    withTimeout(getPlaceDetails(biz.name, biz.location.city), 5000),
  ]);
  const { review, photoUrl } = details ?? { review: null, photoUrl: null };

  // Send photo if available
  if (photoUrl) {
    await sendMessage(chatId, { parts: [{ type: 'media', url: photoUrl }] });
    await sleep(300);
  }

  const crowdLine = crowd ? `\n\n${crowd}` : '';

  let reviewLine = '';
  if (review) {
    const stars = '⭐'.repeat(Math.min(review.rating, 5));
    const snippet = review.text.length > 120 ? review.text.slice(0, 120) + '…' : review.text;
    reviewLine = `\n\n💬 "${snippet}"\n— ${review.author} ${stars} · ${review.relativeTime}`;
  }

  await sendMessage(chatId, {
    parts: [{ type: 'text', value: `Saved ${biz.name}! 📍\n📞 ${phone}\n${cleanUrl(biz.url)}${crowdLine}${reviewLine}` }],
    effect: { type: 'screen', name: 'hearts' },
  });

  // Offer reservation booking
  await sleep(400);
  await sendMessage(chatId, {
    parts: [{ type: 'text', value: `Want me to check reservation availability? 📅\nJust tell me when — e.g. "Saturday 7pm for 2"` }],
  });
}

// ── Booking flow ──────────────────────────────────────────────────────────────

async function handleBookingDetails(
  handle: string,
  chatId: string,
  text: string,
  biz: YelpBusiness,
): Promise<void> {
  await startTyping(chatId);

  const ctx = getSession(handle)?.booking;

  // ── Case 1: user is answering "how many people?" ─────────────────────────
  if (ctx?.pendingDatetime) {
    const coversOnly = parseInt(text.trim(), 10);
    if (!isNaN(coversOnly) && coversOnly > 0) {
      ctx.pendingDatetime = undefined;
      await runOpenTableSearch(handle, chatId, biz, ctx.pendingDatetime ?? '', coversOnly);
      return;
    }
    // Not a number — treat as cancel
    setStep(handle, 'idle');
    setBooking(handle, undefined);
    await sendMessage(chatId, { parts: [{ type: 'text', value: `No worries! Text me anytime 🍽️` }] });
    return;
  }

  // ── Case 2: fresh booking request ────────────────────────────────────────

  // "yes / sure / yeah / ok" — they want to book but haven't given details yet
  if (/^(yes|yeah|sure|ok|okay|yep|yup|absolutely|please|sounds good|let's do it|let's go|go ahead|do it)$/i.test(text.trim())) {
    await sendMessage(chatId, {
      parts: [{ type: 'text', value: `When would you like to go? 📅\ne.g. "Saturday 7pm for 2"` }],
    });
    return; // stay in awaiting_booking_details
  }

  // "no / nah / skip" — they don't want to book
  if (/^(no|nah|nope|skip|cancel|never mind|nvm|not now|maybe later)$/i.test(text.trim())) {
    setStep(handle, 'idle');
    setBooking(handle, undefined);
    await sendMessage(chatId, { parts: [{ type: 'text', value: `No worries! Text me anytime 🍽️` }] });
    return;
  }

  const req = await parseBookingRequest(text);

  if (!req.valid) {
    // Doesn't look like a date/time — ask again rather than cancelling
    await sendMessage(chatId, {
      parts: [{ type: 'text', value: `Just tell me when — e.g. "Saturday 7pm for 2" 📅\n(or "no" to skip)` }],
    });
    return; // stay in awaiting_booking_details
  }

  // Got date/time but no party size → ask first, store datetime
  if (!req.covers_specified) {
    const session2 = getSession(handle);
    if (session2?.booking) session2.booking.pendingDatetime = req.datetime;
    // Extract just the date/time part for the confirmation message
    const when = req.readable.replace(/for \d+$/, '').trim();
    await sendMessage(chatId, {
      parts: [{ type: 'text', value: `Got it — ${when}! How many people? 👥` }],
    });
    return; // stay in awaiting_booking_details
  }

  await runOpenTableSearch(handle, chatId, biz, req.datetime, req.covers);
}

async function runOpenTableSearch(
  handle: string,
  chatId: string,
  biz: YelpBusiness,
  datetime: string,
  covers: number,
): Promise<void> {
  const readableTime = formatBookingTime(datetime, covers);

  await sendMessage(chatId, {
    parts: [{ type: 'text', value: `Checking OpenTable for ${biz.name} — ${readableTime}... 🔍` }],
  });

  // Find on OpenTable
  const ot = await withTimeout(findOnOpenTable(biz.name, biz.location.city), 8000);

  if (!ot) {
    setStep(handle, 'idle');
    setBooking(handle, undefined);
    const addr = [biz.location.address1, biz.location.city].filter(Boolean).join(', ');
    const phone = biz.phone || 'no phone listed';
    await sendMessage(chatId, {
      parts: [{ type: 'text', value: `${biz.name} isn't available for online booking through our API 😕\n\nGive them a call to reserve directly:\n📞 ${phone}\n📍 ${addr}` }],
    });
    return;
  }

  // Fetch available slots
  const slots = await withTimeout(getAvailability(ot.rid, datetime, covers), 8000) ?? [];

  if (!slots || slots.length === 0) {
    setStep(handle, 'idle');
    setBooking(handle, undefined);
    const bookUrl = buildBookingUrl(ot.rid, datetime, covers);
    await sendMessage(chatId, {
      parts: [{ type: 'text', value: `No availability found for that exact time 😕\nCheck other times on OpenTable 👇\n${bookUrl}` }],
    });
    return;
  }

  // Show up to 5 slots
  const shown = slots.slice(0, 5);
  setBooking(handle, { biz, otRid: ot.rid, slots: shown, covers });
  setStep(handle, 'awaiting_booking_slot');

  const slotList = shown.map((s, i) => `${i + 1}. ${s.time}`).join('\n');
  await sendMessage(chatId, {
    parts: [{ type: 'text', value: `✅ Found ${ot.name} on OpenTable!\nAvailable times for ${covers} guests:\n\n${slotList}\n\nReply with a number to book, or "cancel" to skip 📅` }],
  });
}

function formatBookingTime(isoDatetime: string, covers: number): string {
  const d = new Date(isoDatetime);
  if (isNaN(d.getTime())) return isoDatetime;
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const timeStr = m === 0 ? `${h12}:00 ${ampm}` : `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()} at ${timeStr} for ${covers}`;
}

async function handleBookingSlot(
  handle: string,
  chatId: string,
  text: string,
): Promise<void> {
  const session = getSession(handle);
  const ctx = session?.booking;
  if (!ctx || !ctx.slots || !ctx.otRid) {
    setStep(handle, 'idle');
    return;
  }

  if (/^(cancel|no|skip|never mind|nvm)/i.test(text.trim())) {
    setStep(handle, 'idle');
    setBooking(handle, undefined);
    await sendMessage(chatId, { parts: [{ type: 'text', value: `No problem! Text me anytime 🍽️` }] });
    return;
  }

  const pick = parseInt(text.trim(), 10);
  if (isNaN(pick) || pick < 1 || pick > ctx.slots.length) {
    await sendMessage(chatId, {
      parts: [{ type: 'text', value: `Reply with a number 1–${ctx.slots.length} to pick a time ☝️` }],
    });
    return;
  }

  const slot = ctx.slots[pick - 1];
  const url = buildBookingUrl(ctx.otRid, slot.datetime, ctx.covers ?? 2);

  setStep(handle, 'idle');
  setBooking(handle, undefined);

  await sendMessage(chatId, {
    parts: [{ type: 'text', value: `${slot.time} it is! Tap below to confirm your reservation at ${ctx.biz.name} 🎉\n\n${url}` }],
    effect: { type: 'screen', name: 'confetti' },
  });
}

// ── Reaction handler ──────────────────────────────────────────────────────────

export async function handleReaction(sub: Subscriber, messageId: string): Promise<void> {
  const biz = resolveMessage(messageId);
  if (!biz) return;
  saveRestaurant(sub.handle, biz);
  setBooking(sub.handle, { biz });
  setStep(sub.handle, 'awaiting_booking_details');
  await confirmSave(sub.chatId, biz);
}

// ── Main message handler ──────────────────────────────────────────────────────

export async function handleFoodMessage(sub: Subscriber, text: string): Promise<void> {
  const { handle, chatId } = sub;
  const session = getOrCreateSession(handle, chatId);

  // ── Booking slot selection ───────────────────────────────────────────────
  if (session.step === 'awaiting_booking_slot') {
    await handleBookingSlot(handle, chatId, text);
    return;
  }

  // ── Booking details (when/how many) ─────────────────────────────────────
  if (session.step === 'awaiting_booking_details') {
    const biz = session.booking?.biz;
    if (biz) {
      await handleBookingDetails(handle, chatId, text, biz);
    } else {
      setStep(handle, 'idle');
    }
    return;
  }

  // ── Awaiting city after being asked ─────────────────────────────────────
  if (session.step === 'awaiting_location') {
    const location = text.trim();
    const cuisine = session.cuisine ?? 'restaurants';
    await sendMessage(chatId, {
      parts: [{ type: 'text', value: `Searching for ${cuisine} in ${location}... 🔍` }],
    });
    try {
      const { businesses } = await fetchRelevant(cuisine, location, { limit: 3 });
      if (businesses.length === 0) {
        await sendMessage(chatId, { parts: [{ type: 'text', value: "No results found 😕 Try a different search." }] });
        setStep(handle, 'idle');
        return;
      }
      const placeData = await fetchPlaceData(businesses);
      setLastResults(handle, businesses);
      setLastSearch(handle, { term: cuisine, location, offset: 0 });
      setStep(handle, 'awaiting_selection');
      await sendResults(chatId, businesses, placeData.map((d) => d.photoUrl), placeData.map((d) => d.attributes), placeData.map((d) => d.summary));
    } catch (err) {
      console.error('[search] error:', err);
      setStep(handle, 'idle');
      await sendMessage(chatId, {
        parts: [{ type: 'text', value: "Something went wrong 😕 Try again in a moment." }],
      });
    }
    return;
  }

  // ── Awaiting selection (1/2/3 or "more") ────────────────────────────────
  if (session.step === 'awaiting_selection') {
    const normalized = text.trim().toLowerCase();

    // "more", "next", "show more", etc. → paginate
    if (/^(more|next|show more|more options|other options|different)/.test(normalized)) {
      const prev = session.lastSearch;
      if (!prev) {
        await sendMessage(chatId, { parts: [{ type: 'text', value: "No previous search to paginate 🤔 Try a new search." }] });
        return;
      }
      const nextOffset = prev.offset + 3;
      await sendMessage(chatId, { parts: [{ type: 'text', value: `Fetching more results... 🔍` }] });
      try {
        const businesses = await searchBusinesses(prev.term, prev.location, {
          limit: 3,
          price: prev.price ?? undefined,
          open_now: prev.open_now,
          offset: nextOffset,
        });
        if (businesses.length === 0) {
          await sendMessage(chatId, { parts: [{ type: 'text', value: "No more results found 😕 Try a different search." }] });
          return;
        }
        const placeData = await fetchPlaceData(businesses);
        setLastResults(handle, businesses);
        setLastSearch(handle, { ...prev, offset: nextOffset });
        await sendResults(chatId, businesses, placeData.map((d) => d.photoUrl), placeData.map((d) => d.attributes), placeData.map((d) => d.summary));
      } catch (err) {
        console.error('[yelp] paginate error:', err);
        await sendMessage(chatId, { parts: [{ type: 'text', value: "Couldn't fetch more results 😕" }] });
      }
      return;
    }

    const pick = parseInt(text.trim(), 10);
    if (isNaN(pick) || pick < 1 || pick > session.lastResults.length) {
      // Answer a contextual question about the current results (e.g. "which has the least wait time")
      if (session.lastResults.length > 0) {
        try {
          const answer = await answerAboutResults(text, session.lastResults);
          if (answer) {
            await sendMessage(chatId, { parts: [{ type: 'text', value: answer }] });
            return;
          }
        } catch {
          // fall through
        }
      }
      // Check if this is a new food search — break out of selection state naturally
      try {
        const intent = await parseIntent(text);
        if (intent.is_food_query) {
          setStep(handle, 'idle');
          // Re-enter the main flow with the new intent
          await handleFoodMessage(sub, text);
          return;
        }
      } catch {
        // fall through
      }
      await sendMessage(chatId, {
        parts: [{ type: 'text', value: `Reply 1, 2, or 3 to save — or text "more" for different options 📌` }],
      });
      return;
    }

    const biz = session.lastResults[pick - 1];
    saveRestaurant(handle, biz);
    setBooking(handle, { biz });
    setStep(handle, 'awaiting_booking_details');
    await confirmSave(chatId, biz);
    return;
  }

  // ── AI intent parsing ────────────────────────────────────────────────────
  await startTyping(chatId);

  let intent;
  try {
    intent = await parseIntent(text);
  } catch (err) {
    console.error('[gemini] intent parse error:', err);
    await sendMessage(chatId, {
      parts: [{ type: 'text', value: "Having trouble understanding that 🤔 Try: \"find me sushi in Boston\"" }],
    });
    return;
  }

  // ── Evening plan — hand off to multi-search orchestrator ────────────────
  if (intent.is_evening_plan) {
    const city = intent.location ?? sub.city ?? '';
    if (!city) {
      await sendMessage(chatId, {
        parts: [{ type: 'text', value: `Which city or neighborhood? 📍 (e.g. "plan a night out in Back Bay")` }],
      });
      return;
    }
    await planEvening(chatId, text, city);
    return;
  }

  // ── Not a food query — check saved spots first ───────────────────────────
  if (!intent.is_food_query) {
    if (session.saved.length > 0) {
      try {
        const answer = await compareSaved(text, session.saved);
        if (answer) {
          await sendMessage(chatId, { parts: [{ type: 'text', value: answer }] });
          return;
        }
      } catch {
        // fall through to generic prompt
      }
    }
    await sendMessage(chatId, {
      parts: [{ type: 'text', value: `hey ${sub.name || ''}! text me what you're craving and where, e.g. "find me tacos in Austin" 🌮`.trim() }],
    });
    return;
  }

  // ── Resolve location ──────────────────────────────────────────────────────
  let location = intent.location;
  let price = intent.price;
  let open_now = intent.open_now;
  let term = intent.term;

  // If Gemini extracted a neighborhood but no full city, append stored city
  // e.g. "Newbury area" + city="Boston" → "Newbury area, Boston"
  if (location && sub.city) {
    const cityLower = sub.city.toLowerCase();
    const locLower = location.toLowerCase();
    if (!locLower.includes(cityLower)) {
      location = `${location}, ${sub.city}`;
    }
  }

  if (!location) {
    // Try carry-over refinement from previous search
    const prev = session.lastSearch;
    if (prev) {
      try {
        const refined = await refineSearch(text, prev);
        if (refined.is_refinement) {
          location = refined.location;
          term = refined.term;
          price = refined.price;
          open_now = refined.open_now;
        }
      } catch {
        // fall through
      }
    }

    // Still no location — use stored city or ask
    if (!location) {
      if (sub.city) {
        location = sub.city;
      } else {
        setStep(handle, 'awaiting_location', term);
        await sendMessage(chatId, {
          parts: [{ type: 'text', value: `Which city? 📍 (searching for "${term}")` }],
        });
        return;
      }
    }
  }

  const filters: string[] = [];
  if (price) filters.push(price);
  if (open_now) filters.push('open now');
  const filterStr = filters.length ? ` (${filters.join(', ')})` : '';

  await sleep(400);
  await sendMessage(chatId, {
    parts: [{ type: 'text', value: `Searching for ${term} in ${location}${filterStr}... 🔍` }],
  });

  // Widen radius for specific dishes — they're rarer and may be farther away
  const radius = intent.specific_dish ? 15000 : 5000;

  try {
    const { businesses, source } = await fetchRelevant(term, location, {
      price: price ?? undefined,
      open_now,
      radius,
    });

    if (source === 'google') {
      console.log(`[google-fallback] Yelp had no results for "${term}" in "${location}" — using Google Places`);
    }

    // ── Auto-fallback when zero results from both ─────────────────────────
    if (businesses.length === 0) {
      await sendMessage(chatId, {
        parts: [{ type: 'text', value: "No results found nearby 😕 Try rephrasing or a different area." }],
      });
      return;
    }

    const placeData = sortByAttributes(await fetchPlaceData(businesses), intent.attributes ?? []);
    const sorted = placeData.map((d) => d.biz);
    setLastResults(handle, sorted);
    setLastSearch(handle, { term, location, price, open_now, offset: 0 });
    setStep(handle, 'awaiting_selection');
    await sendResults(chatId, sorted, placeData.map((d) => d.photoUrl), placeData.map((d) => d.attributes), placeData.map((d) => d.summary));
  } catch (err) {
    console.error('[search] error:', err);
    setStep(handle, 'idle');
    await sendMessage(chatId, {
      parts: [{ type: 'text', value: "Something went wrong searching right now 😕 Try again in a moment." }],
    });
  }
}

// ── Group chat handlers ───────────────────────────────────────────────────────

export async function handleGroupFoodMessage(
  chatId: string,
  text: string,
  city: string,
): Promise<void> {
  const session = getOrCreateGroupSession(chatId);

  // Parse intent — only handle food queries
  let intent;
  try {
    intent = await parseIntent(text);
  } catch {
    return;
  }
  if (!intent.is_food_query) return;

  // Evening plan in group context
  if (intent.is_evening_plan) {
    const loc = intent.location ?? city;
    if (!loc) {
      await sendMessage(chatId, { parts: [{ type: 'text', value: `Which neighborhood? 📍` }] });
      return;
    }
    await planEvening(chatId, text, loc);
    return;
  }

  const location = intent.location ?? city;
  if (!location) {
    await sendMessage(chatId, {
      parts: [{ type: 'text', value: `Where are you all headed? Drop a city or neighborhood 📍` }],
    });
    return;
  }

  const radius = intent.specific_dish ? 15000 : 5000;
  await sendMessage(chatId, {
    parts: [{ type: 'text', value: `Searching for ${intent.term} in ${location}... 🔍` }],
  });

  try {
    const { businesses } = await fetchRelevant(intent.term, location, {
      price: intent.price ?? undefined,
      open_now: intent.open_now,
      radius,
    });

    if (businesses.length === 0) {
      await sendMessage(chatId, { parts: [{ type: 'text', value: `Nothing found nearby 😕 Try a different spot.` }] });
      return;
    }

    const placeData = sortByAttributes(await fetchPlaceData(businesses), intent.attributes ?? []);
    const sorted = placeData.map((d) => d.biz);

    // Track messageId → business for reaction voting
    const msgToBiz = new Map<string, YelpBusiness>();

    // Send cards — reuse browse formatting but capture message IDs
    const { formatCard } = await import('./browse.js');
    for (let i = 0; i < sorted.length; i++) {
      const biz = sorted[i];
      const photo = placeData[i].photoUrl;
      if (photo) {
        await sendMessage(chatId, { parts: [{ type: 'media', url: photo }] });
        await sleep(200);
      }
      const card = formatCard(i + 1, biz, placeData[i].attributes, placeData[i].summary);
      const msg = await sendMessage(chatId, { parts: [{ type: 'text', value: card }] });
      msgToBiz.set(msg.id, biz);
      if (i < sorted.length - 1) await sleep(300);
    }

    setGroupVoting(chatId, sorted, msgToBiz);

    await sleep(300);
    await sendMessage(chatId, {
      parts: [{ type: 'text', value: `React ❤️ to vote for your pick — text "who's winning" to see results 🗳️` }],
    });
  } catch (err) {
    console.error('[group] search error:', err);
    await sendMessage(chatId, { parts: [{ type: 'text', value: `Couldn't reach Yelp right now 😕` }] });
  }
}

export async function handleGroupVoteReveal(chatId: string): Promise<void> {
  const results = getVoteResults(chatId);
  const hasVotes = results.some((r) => r.votes > 0);

  if (!hasVotes) {
    await sendMessage(chatId, {
      parts: [{ type: 'text', value: `No votes yet! React ❤️ to your pick first 🗳️` }],
    });
    return;
  }

  const tally = results
    .map((r, i) => `${i === 0 ? '🏆' : `${i + 1}.`} ${r.biz.name} — ${r.votes} vote${r.votes !== 1 ? 's' : ''}`)
    .join('\n');

  const winner = results[0];
  resetGroupSession(chatId);

  await sendMessage(chatId, {
    parts: [{ type: 'text', value: `Results are in! 🗳️\n\n${tally}\n\nThe group is going to ${winner.biz.name}! 🎉` }],
    effect: { type: 'screen', name: 'confetti' },
  });
}

export async function handleFoodCommand(sub: Subscriber, cmd: string): Promise<boolean> {
  const { handle, chatId } = sub;

  if (cmd === '/food') {
    resetSession(handle, chatId);
    await sendMessage(chatId, {
      parts: [{ type: 'text', value: "What are you looking for? Tell me anything — \"cheap ramen in NYC open now\", \"best brunch in Chicago\", whatever you're craving 🍽️" }],
    });
    return true;
  }

  if (cmd === '/saved') {
    const session = getOrCreateSession(handle, chatId);
    await sendSaved(chatId, session.saved);
    return true;
  }

  return false;
}
