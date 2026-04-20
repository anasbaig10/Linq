import * as linq from '../linq/index.js';
import { sendMessage } from '../linq/client.js';
import * as state from '../state/index.js';

// ── Entry point: called when a message arrives from an unknown sender ─────────

export async function startOnboarding(handle: string, chatId: string): Promise<void> {
  state.createSubscriber(handle, chatId);

  await linq.markAsRead(chatId);
  await linq.startTyping(chatId);
  await linq.sleep(1000);
  await linq.stopTyping(chatId);

  await linq.shareContactCard(chatId).catch(() => {});
  state.updateSubscriber(handle, { contactCardShared: true });

  await linq.sendMultiMessage(
    chatId,
    [
      "hey! 👋 i'm Linq Food Finder — your personal restaurant scout via iMessage.",
      "what's your name?",
    ].join('\n---\n'),
  );
}

// ── Resume onboarding after each reply ───────────────────────────────────────

export async function continueOnboarding(
  sub: state.Subscriber,
  text: string,
): Promise<boolean> {
  const { handle, chatId, onboarding } = sub;

  await linq.markAsRead(chatId);

  if (onboarding === 'awaiting_name') {
    const name = toTitleCase(text.trim());
    state.updateSubscriber(handle, { name, onboarding: 'awaiting_city' });

    await linq.startTyping(chatId);
    await linq.sleep(900);
    await linq.stopTyping(chatId);

    await linq.sendMessage(chatId, {
      parts: [{ type: 'text', value: `nice to meet you, ${name}! 🙌 what city are you based in? 📍` }],
    });
    return true;
  }

  if (onboarding === 'awaiting_city') {
    const city = toTitleCase(text.trim());
    state.updateSubscriber(handle, { city, onboarding: 'complete' });

    await linq.startTyping(chatId);
    await linq.sleep(900);
    await linq.stopTyping(chatId);

    await linq.sendMultiMessage(
      chatId,
      [
        `got it — ${city} 📍`,
        `just tell me what you're craving — e.g. "cheap ramen open now" — and i'll find it 🍽️`,
      ].join('\n---\n'),
      { type: 'screen', name: 'confetti' },
    );
    return true;
  }

  return false;
}

export function isOnboarding(sub: state.Subscriber): boolean {
  return sub.onboarding !== 'complete';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toTitleCase(str: string): string {
  return str.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
