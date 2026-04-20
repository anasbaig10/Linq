import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import * as state from './state/index.js';
import * as onboarding from './onboarding/index.js';
import * as commands from './commands/index.js';
import {
  isMessageReceived,
  isReactionAdded,
  extractText,
  type WebhookEvent,
  type ReactionAddedData,
} from './webhook/types.js';
import {
  handleFoodMessage,
  handleReaction,
  handleGroupFoodMessage,
  handleGroupVoteReveal,
} from './restaurant/handler.js';
import {
  markGroupChat,
  isGroupChat,
  addGroupVote,
} from './restaurant/group.js';

// ── Config ────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3000);

const IGNORED = new Set(
  (process.env.IGNORED_SENDERS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
);

// ── App ───────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    ts: new Date().toISOString(),
    subscribers: state.allSubscribers().length,
  });
});

// ── Webhook ───────────────────────────────────────────────────────────────────

app.post('/webhook', (req: Request, res: Response) => {
  res.sendStatus(200);
  const event = req.body as WebhookEvent;
  processEvent(event).catch((err) => console.error('[webhook] error:', err));
});

// ── Event processing ──────────────────────────────────────────────────────────

async function processEvent(event: WebhookEvent): Promise<void> {
  // ── Reaction events ──────────────────────────────────────────────────────
  if (isReactionAdded(event)) {
    const data = event.data as ReactionAddedData;
    if (data.sender_handle.is_me) return;
    const chatId = data.chat.id;
    const messageId = data.message_id;

    // Group vote
    if (isGroupChat(chatId)) {
      addGroupVote(chatId, messageId);
      return;
    }

    // Individual save
    const sub = state.getSubscriber(data.sender_handle.handle);
    if (sub) await handleReaction(sub, messageId);
    return;
  }

  if (!isMessageReceived(event)) return;

  const data = event.data;
  const { chat } = data;
  const { id: chatId, is_group: isGroup } = chat;

  if (data.direction === 'outbound') return;
  if (data.sender_handle.is_me) return;

  const handle = data.sender_handle.handle;
  if (IGNORED.has(handle)) return;

  const text = extractText(data);
  if (!text) return;

  console.log(`[${isGroup ? 'group' : chatId}] ← ${handle}: ${text}`);

  // ── Group chat ───────────────────────────────────────────────────────────
  if (isGroup) {
    markGroupChat(chatId);

    // Vote reveal commands
    if (/^(\/winner|who'?s winning|show (results|winner)|who won|reveal)/i.test(text)) {
      await handleGroupVoteReveal(chatId);
      return;
    }

    // Look up sender's stored city for location fallback
    const sender = state.getSubscriber(handle);
    const city = sender?.city ?? '';
    await handleGroupFoodMessage(chatId, text, city);
    return;
  }

  // ── Individual chat ──────────────────────────────────────────────────────
  const existing = state.getSubscriberByChatId(chatId) ?? state.getSubscriber(handle);

  if (!existing) {
    await onboarding.startOnboarding(handle, chatId);
    return;
  }

  if (onboarding.isOnboarding(existing)) {
    await onboarding.continueOnboarding(existing, text);
    return;
  }

  if (commands.isCommand(text)) {
    const handled = await commands.handleCommand(existing, text);
    if (!handled) {
      const { sendMessage } = await import('./linq/client.js');
      await sendMessage(existing.chatId, {
        parts: [{ type: 'text', value: `unknown command — text /help to see what's available` }],
      });
    }
    return;
  }

  await handleFoodMessage(existing, text);
}

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🍽️  Linq Food Finder on port ${PORT}`);
  console.log(`   POST http://localhost:${PORT}/webhook`);
  console.log(`   GET  http://localhost:${PORT}/health\n`);
});

export { app };
