import { generate } from './gemini.js';

export interface BookingRequest {
  covers: number;             // party size
  covers_specified: boolean;  // true only if user explicitly said a number
  datetime: string;           // ISO "2026-04-19T19:00"
  readable: string;           // "Saturday April 19th at 7:00 PM for 2"
  valid: boolean;
}

const SYSTEM = `You are a booking assistant. Extract reservation details from a user message.
Return ONLY valid JSON — no markdown, no explanation.

Schema:
{
  "covers": number | null,    // party size — null if not mentioned
  "date": string,             // "YYYY-MM-DD" — resolve relative dates from today (${todayStr()})
  "time": string,             // "HH:MM" 24h format
  "valid": boolean            // false if date/time cannot be determined
}

Examples:
"Saturday 7pm for 2" → {"covers":2,"date":"${nextSaturday()}","time":"19:00","valid":true}
"tomorrow night at 8 for 4" → {"covers":4,"date":"${tomorrow()}","time":"20:00","valid":true}
"tonight at 6:30" → {"covers":null,"date":"${todayStr()}","time":"18:30","valid":true}
"next friday 7:30pm for 3" → {"covers":3,"date":"${nextFriday()}","time":"19:30","valid":true}
"Next Saturday 8pm" → {"covers":null,"date":"${nextSaturday()}","time":"20:00","valid":true}
"yes" → {"covers":null,"date":"","time":"","valid":false}`;

export async function parseBookingRequest(message: string): Promise<BookingRequest> {
  try {
    const raw = await generate(`${SYSTEM}\n\nUser message: "${message}"`);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.valid || !parsed.date || !parsed.time) {
      return { covers: 2, covers_specified: false, datetime: '', readable: '', valid: false };
    }


    const covers_specified = parsed.covers != null;
    const covers = parsed.covers ?? 2;
    const datetime = `${parsed.date}T${parsed.time}`;
    const readable = formatReadable(datetime, covers);
    return { covers, covers_specified, datetime, readable, valid: true };
  } catch {
    return { covers: 2, covers_specified: false, datetime: '', readable: '', valid: false };
  }
}

// ── Date helpers ───────────────────────────────────────────────────────────────

function todayStr(): string {
  return isoDate(new Date());
}

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return isoDate(d);
}

function nextSaturday(): string {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() + ((6 - day + 7) % 7 || 7));
  return isoDate(d);
}

function nextFriday(): string {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() + ((5 - day + 7) % 7 || 7));
  return isoDate(d);
}

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatReadable(isoDatetime: string, covers: number): string {
  const d = new Date(isoDatetime);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const timeStr = m === 0 ? `${h12}:00 ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()} at ${timeStr} for ${covers}`;
}
