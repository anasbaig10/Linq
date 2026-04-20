import type { YelpBusiness } from '../yelp/client.js';

// ── Group session state ───────────────────────────────────────────────────────

interface GroupSession {
  chatId: string;
  step: 'idle' | 'voting';
  businesses: YelpBusiness[];
  votes: Map<string, number>;       // messageId → vote count
  msgToBiz: Map<string, YelpBusiness>; // messageId → business
}

const groups = new Map<string, GroupSession>();
const groupChatIds = new Set<string>(); // known group chat IDs

// ── Public helpers ────────────────────────────────────────────────────────────

export function markGroupChat(chatId: string): void {
  groupChatIds.add(chatId);
}

export function isGroupChat(chatId: string): boolean {
  return groupChatIds.has(chatId);
}

export function getOrCreateGroupSession(chatId: string): GroupSession {
  const existing = groups.get(chatId);
  if (existing) return existing;
  const session: GroupSession = {
    chatId,
    step: 'idle',
    businesses: [],
    votes: new Map(),
    msgToBiz: new Map(),
  };
  groups.set(chatId, session);
  return session;
}

export function setGroupVoting(
  chatId: string,
  businesses: YelpBusiness[],
  msgToBiz: Map<string, YelpBusiness>,
): void {
  const session = getOrCreateGroupSession(chatId);
  session.step = 'voting';
  session.businesses = businesses;
  session.votes = new Map();
  session.msgToBiz = msgToBiz;
}

export function addGroupVote(chatId: string, messageId: string): boolean {
  const session = groups.get(chatId);
  if (!session || session.step !== 'voting') return false;
  if (!session.msgToBiz.has(messageId)) return false;
  session.votes.set(messageId, (session.votes.get(messageId) ?? 0) + 1);
  return true;
}

export interface VoteResult {
  biz: YelpBusiness;
  votes: number;
}

export function getVoteResults(chatId: string): VoteResult[] {
  const session = groups.get(chatId);
  if (!session) return [];

  return session.businesses
    .map((biz) => {
      // find messageId for this biz
      let votes = 0;
      for (const [msgId, b] of session.msgToBiz) {
        if (b.id === biz.id) {
          votes = session.votes.get(msgId) ?? 0;
          break;
        }
      }
      return { biz, votes };
    })
    .sort((a, b) => b.votes - a.votes);
}

export function resetGroupSession(chatId: string): void {
  const session = groups.get(chatId);
  if (session) {
    session.step = 'idle';
    session.businesses = [];
    session.votes = new Map();
    session.msgToBiz = new Map();
  }
}
