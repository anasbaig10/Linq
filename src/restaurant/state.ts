import type { YelpBusiness } from '../yelp/client.js';

export type SessionStep =
  | 'awaiting_cuisine'
  | 'awaiting_location'
  | 'awaiting_selection'
  | 'awaiting_booking_details'   // asked "when & how many?" — waiting for date/time/covers
  | 'awaiting_booking_slot'      // showed time slots — waiting for user to pick one
  | 'idle';

export interface LastSearch {
  term: string;
  location: string;
  price?: string | null;
  open_now?: boolean;
  offset: number;
}

export interface BookingContext {
  biz: YelpBusiness;
  otRid?: number;               // OpenTable restaurant ID (if found)
  slots?: { time: string; datetime: string }[];  // available slots shown to user
  covers?: number;
  pendingDatetime?: string;     // datetime captured but covers not yet known
}

export interface RestaurantSession {
  handle: string;
  chatId: string;
  step: SessionStep;
  cuisine?: string;
  lastResults: YelpBusiness[];
  lastSearch?: LastSearch;
  saved: YelpBusiness[];
  booking?: BookingContext;      // active booking in progress
}

// handle → session
const sessions = new Map<string, RestaurantSession>();

// ── Session helpers ────────────────────────────────────────────────────────────

export function getSession(handle: string): RestaurantSession | undefined {
  return sessions.get(handle);
}

export function getOrCreateSession(handle: string, chatId: string): RestaurantSession {
  const existing = sessions.get(handle);
  if (existing) return existing;
  const session: RestaurantSession = { handle, chatId, step: 'idle', lastResults: [], saved: [] };
  sessions.set(handle, session);
  return session;
}

export function setStep(handle: string, step: SessionStep, cuisine?: string): void {
  const session = sessions.get(handle);
  if (!session) return;
  session.step = step;
  if (cuisine !== undefined) session.cuisine = cuisine;
}

export function setLastResults(handle: string, results: YelpBusiness[]): void {
  const session = sessions.get(handle);
  if (session) session.lastResults = results;
}

export function setLastSearch(handle: string, search: LastSearch): void {
  const session = sessions.get(handle);
  if (session) session.lastSearch = search;
}

export function resetSession(handle: string, chatId: string): void {
  sessions.set(handle, { handle, chatId, step: 'idle', lastResults: [], saved: [] });
}

export function saveRestaurant(handle: string, biz: YelpBusiness): void {
  const session = sessions.get(handle);
  if (!session) return;
  const alreadySaved = session.saved.some((s) => s.id === biz.id);
  if (!alreadySaved) session.saved.push(biz);
}

export function setBooking(handle: string, booking: BookingContext | undefined): void {
  const session = sessions.get(handle);
  if (session) session.booking = booking;
}

// ── Message → business tracking (for reactions) ────────────────────────────────

const messageMap = new Map<string, YelpBusiness>();

export function trackMessage(messageId: string, biz: YelpBusiness): void {
  messageMap.set(messageId, biz);
}

export function resolveMessage(messageId: string): YelpBusiness | undefined {
  return messageMap.get(messageId);
}
