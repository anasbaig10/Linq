// ── Types ─────────────────────────────────────────────────────────────────────

export type OnboardingStep = 'awaiting_name' | 'awaiting_city' | 'complete';

export interface Subscriber {
  handle: string;        // E.164 phone number
  chatId: string;
  name: string;
  city?: string;
  subscribedAt: Date;
  contactCardShared: boolean;
  onboarding: OnboardingStep;
}

// ── In-memory stores ──────────────────────────────────────────────────────────

const subscribers = new Map<string, Subscriber>();   // handle → Subscriber
const chatToHandle = new Map<string, string>();       // chatId → handle

// ── Subscriber helpers ────────────────────────────────────────────────────────

export function getSubscriber(handle: string): Subscriber | undefined {
  return subscribers.get(handle);
}

export function getSubscriberByChatId(chatId: string): Subscriber | undefined {
  const handle = chatToHandle.get(chatId);
  return handle ? subscribers.get(handle) : undefined;
}

export function createSubscriber(handle: string, chatId: string): Subscriber {
  const sub: Subscriber = {
    handle,
    chatId,
    name: '',
    subscribedAt: new Date(),
    contactCardShared: false,
    onboarding: 'awaiting_name',
  };
  subscribers.set(handle, sub);
  chatToHandle.set(chatId, handle);
  return sub;
}

export function updateSubscriber(handle: string, updates: Partial<Subscriber>): void {
  const sub = subscribers.get(handle);
  if (sub) Object.assign(sub, updates);
}

export function allSubscribers(): Subscriber[] {
  return Array.from(subscribers.values());
}

export function deleteSubscriber(handle: string): void {
  const sub = subscribers.get(handle);
  if (sub) chatToHandle.delete(sub.chatId);
  subscribers.delete(handle);
}
