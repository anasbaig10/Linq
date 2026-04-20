export interface WebhookEvent {
  api_version: string;
  event_type: string;
  event_id: string;
  created_at: string;
  trace_id: string;
  partner_id: string;
  data: unknown;
}

export interface IncomingTextPart { type: 'text'; value: string }
export interface IncomingMediaPart { type: 'media'; url: string; mime_type?: string }
export type IncomingPart = IncomingTextPart | IncomingMediaPart;

// Actual v3 webhook payload — message fields are flat inside data
export interface MessageReceivedData {
  id: string;           // message id
  direction: 'inbound' | 'outbound';
  service: string;
  parts: IncomingPart[];
  sender_handle: { handle: string; is_me: boolean };
  chat: { id: string; is_group: boolean; service: string };
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  effect: unknown;
}

export interface MessageReceivedEvent extends WebhookEvent {
  event_type: 'message.received';
  data: MessageReceivedData;
}

export function isMessageReceived(e: WebhookEvent): e is MessageReceivedEvent {
  return e.event_type === 'message.received';
}

export function extractText(data: MessageReceivedData): string {
  return data.parts
    .filter((p): p is IncomingTextPart => p.type === 'text')
    .map((p) => p.value)
    .join(' ')
    .trim();
}

// ── Reaction event ────────────────────────────────────────────────────────────

export interface ReactionAddedData {
  message_id: string;
  reaction: string;
  sender_handle: { handle: string; is_me: boolean };
  chat: { id: string };
}

export interface ReactionAddedEvent extends WebhookEvent {
  event_type: 'reaction.added';
  data: ReactionAddedData;
}

export function isReactionAdded(e: WebhookEvent): e is ReactionAddedEvent {
  return e.event_type === 'reaction.added';
}
