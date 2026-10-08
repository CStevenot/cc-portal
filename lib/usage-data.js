// Live usage counts for one org and period, read from Retell and Shopify. Nothing is stored.
import { listCallsForAgents } from "./shopify/retell";
import { listChatsInRange, getChat, visitorSpoke } from "./chat";
import { adminGraphql } from "./shopify/api";
import { minutesInPeriod, chatsInPeriod, countEngaged } from "./meter";

// Ended chats never change, so whether the visitor spoke is cached per warm instance.
const engagedCache = new Map();
async function isEngaged(c) {
  if (engagedCache.has(c.chat_id)) return engagedCache.get(c.chat_id);
  const full = await getChat(c.chat_id);
  const v = !!full && visitorSpoke(full);
  if (c.chat_status === "ended" && engagedCache.size < 20000) engagedCache.set(c.chat_id, v);
  return v;
}

// Checkout links the agent created on a call (each one is texted to the caller).
// Counted from the store's draft orders the agent tagged, so nothing extra is stored.
export async function countCallTexts(shop, token, start, end) {
  const q = `tag:client-connected-voice created_at:>='${new Date(start).toISOString()}' created_at:<'${new Date(end).toISOString()}'`;
  let n = 0, after = null;
  for (let page = 0; page < 40; page++) {
    const data = await adminGraphql(shop, token, `query($q: String!, $after: String) {
      draftOrders(first: 250, after: $after, query: $q) { nodes { id } pageInfo { hasNextPage endCursor } } }`, { q, after });
    const d = data?.draftOrders;
    n += d?.nodes?.length || 0;
    if (!d?.pageInfo?.hasNextPage) break;
    after = d.pageInfo.endCursor;
  }
  return n;
}

// { minutes, chats, texts } for the org's agents in [start, end). texts is null when the
// store isn't connected; a failing source returns null for that medium, not an error.
export async function usageCounts({ agentIds, shop, token, start, end }) {
  const [minutes, chats, texts] = await Promise.all([
    listCallsForAgents(agentIds, { start, end }).then((calls) => minutesInPeriod(calls, start, end)),
    listChatsInRange(agentIds, start, end)
      .then((list) => countEngaged(chatsInPeriod(list.filter((c) => agentIds.includes(c.agent_id)), start, end), isEngaged)),
    shop && token ? countCallTexts(shop, token, start, end).catch(() => null) : Promise.resolve(null),
  ]);
  return { minutes, chats, texts };
}
