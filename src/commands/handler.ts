import * as linq from '../linq/index.js';
import * as state from '../state/index.js';
import { handleFoodCommand } from '../restaurant/handler.js';

// ── Parse and dispatch a command ──────────────────────────────────────────────

export async function handleCommand(
  sub: state.Subscriber,
  text: string,
): Promise<boolean> {
  const { chatId, handle } = sub;
  const cmd = text.trim().split(/\s+/)[0].toLowerCase();

  switch (cmd) {
    // ── /food — start restaurant search ────────────────────────────────────
    case '/food': {
      await linq.markAsRead(chatId);
      return handleFoodCommand(sub, '/food');
    }

    // ── /saved — show saved spots ───────────────────────────────────────────
    case '/saved': {
      await linq.markAsRead(chatId);
      return handleFoodCommand(sub, '/saved');
    }

    // ── /unsubscribe ────────────────────────────────────────────────────────
    case '/unsubscribe':
    case '/stop': {
      await linq.markAsRead(chatId);
      await linq.sendMessage(chatId, {
        parts: [{ type: 'text', value: `ok, unsubscribed 👋 text us anytime to chat again` }],
      });
      state.deleteSubscriber(handle);
      return true;
    }

    // ── /help ───────────────────────────────────────────────────────────────
    case '/help': {
      await linq.markAsRead(chatId);
      await linq.sendMessage(chatId, {
        parts: [{
          type: 'text',
          value: [
            '🍽️ Linq Food Finder',
            '',
            'Just tell me what you want, e.g.:',
            '  "cheap ramen in Boston open now"',
            '  "best sushi in NYC tonight"',
            '  "spicy tacos near downtown Chicago"',
            '',
            '/food — start a new search',
            '/saved — your saved spots',
            '/stop — unsubscribe',
          ].join('\n'),
        }],
      });
      return true;
    }

    default:
      return false;
  }
}

export function isCommand(text: string): boolean {
  return text.trim().startsWith('/');
}
