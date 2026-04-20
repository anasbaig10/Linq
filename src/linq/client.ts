import 'dotenv/config';

const BASE_URL = process.env.LINQ_API_BASE_URL ?? 'https://api.linqapp.com/api/partner/v3';
const TOKEN = process.env.LINQ_API_TOKEN ?? '';

export type MessageService = 'iMessage' | 'SMS' | 'RCS';

export interface MessagePart {
  type: 'text' | 'media' | 'link';
  value?: string;
  url?: string;
}

export type ScreenEffect =
  | 'confetti' | 'fireworks' | 'lasers' | 'sparkles' | 'celebration'
  | 'hearts' | 'love' | 'balloons' | 'happy_birthday' | 'echo' | 'spotlight';

export type BubbleEffect = 'slam' | 'loud' | 'gentle' | 'invisible';

export interface MessageEffect {
  type: 'screen' | 'bubble';
  name: ScreenEffect | BubbleEffect;
}

export interface MessageContent {
  parts: MessagePart[];
  effect?: MessageEffect;
  idempotency_key?: string;
}

export interface ChatHandle {
  id: string;
  handle: string;
  is_me: boolean;
  service: MessageService;
  status: string;
}

export interface Chat {
  id: string;
  display_name: string | null;
  service: MessageService;
  is_group: boolean;
  handles: ChatHandle[];
}

// ── Internal fetch wrapper ────────────────────────────────────────────────────

async function linqFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers as Record<string, string> ?? {}),
    },
  });

  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => '');
    throw new Error(`Linq ${options.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
  }

  return res;
}

const chatCache = new Map<string, Chat>();

// ── Chat ──────────────────────────────────────────────────────────────────────

export async function createChat(
  from: string,
  to: string[],
  message: MessageContent,
): Promise<Chat & { message: { id: string } }> {
  const res = await linqFetch('/chats', {
    method: 'POST',
    body: JSON.stringify({ from, to, message }),
  });
  const data = await res.json();
  chatCache.set(data.chat.id, data.chat);
  return data.chat;
}

export async function getChat(chatId: string): Promise<Chat> {
  if (chatCache.has(chatId)) return chatCache.get(chatId)!;
  const res = await linqFetch(`/chats/${chatId}`);
  const chat: Chat = await res.json();
  chatCache.set(chatId, chat);
  return chat;
}

// ── Messages ──────────────────────────────────────────────────────────────────

export async function sendMessage(
  chatId: string,
  message: MessageContent,
): Promise<{ id: string }> {
  const res = await linqFetch(`/chats/${chatId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
  const data = await res.json();
  return data.message ?? data;
}

export async function sendReaction(
  messageId: string,
  reaction: string,
  operation: 'add' | 'remove' = 'add',
): Promise<void> {
  await linqFetch(`/messages/${messageId}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ reaction, operation }),
  });
}

// ── Presence ──────────────────────────────────────────────────────────────────

export async function markAsRead(chatId: string): Promise<void> {
  await linqFetch(`/chats/${chatId}/read`, { method: 'POST' });
}

export async function startTyping(chatId: string): Promise<void> {
  await linqFetch(`/chats/${chatId}/typing`, { method: 'POST' });
}

export async function stopTyping(chatId: string): Promise<void> {
  await linqFetch(`/chats/${chatId}/typing`, { method: 'DELETE' });
}

export async function shareContactCard(chatId: string): Promise<void> {
  await linqFetch(`/chats/${chatId}/share_contact_card`, { method: 'POST' });
}

// ── Multi-message send ────────────────────────────────────────────────────────

export async function sendMultiMessage(
  chatId: string,
  text: string,
  effect?: MessageEffect,
): Promise<void> {
  const segments = text
    .split(/\n?---\n?/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (let i = 0; i < segments.length; i++) {
    const isLast = i === segments.length - 1;
    await sendMessage(chatId, {
      parts: [{ type: 'text', value: segments[i] }],
      ...(isLast && effect ? { effect } : {}),
    });
    if (!isLast) await sleep(800 + Math.random() * 600);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
