const axios = require("axios");

const BOARD_ID = "BUk0xpGt";
const DEFAULT_LIST_ID = "62b3554c15a79549f9f3f52d";
const KEY = process.env.TRELLO_KEY;
const TOKEN = process.env.TRELLO_TOKEN;
const API_BASE = "https://api.trello.com/1";

function credentials() {
  if (!KEY || !TOKEN) {
    throw new Error("Trello server credentials are not configured");
  }
  return { key: KEY, token: TOKEN };
}

async function fetchTodoLists() {
  const { data } = await axios.get(`${API_BASE}/boards/${BOARD_ID}/lists`, {
    params: {
      ...credentials(),
      filter: "open",
      fields: "id,name,pos",
    },
  });

  const lists = data.sort((a, b) => a.pos - b.pos);
  const todayIndex = lists.findIndex(
    (list) => list.name.trim().toLowerCase() === "today",
  );
  if (todayIndex === -1) {
    throw new Error('The Trello board does not contain an open "Today" list');
  }

  return lists.slice(0, todayIndex + 1);
}

async function fetchTodoCards(listId = DEFAULT_LIST_ID) {
  const { data } = await axios.get(`${API_BASE}/lists/${listId}/cards`, {
    params: {
      ...credentials(),
      filter: "open",
      fields: "id,name,desc,due,dueComplete,labels,pos,shortUrl",
    },
  });

  return data.sort((a, b) => a.pos - b.pos);
}

async function fetchCard(cardId) {
  const { data } = await axios.get(`${API_BASE}/cards/${cardId}`, {
    params: {
      ...credentials(),
      fields: "id,idList,closed,dueComplete",
    },
  });
  return data;
}

function assertAllowedList(listId, allowedListIds) {
  if (!allowedListIds.includes(listId)) {
    const error = new Error("Card does not belong to an available to-do list");
    error.status = 404;
    throw error;
  }
}

async function createTodoCard(listId, name) {
  const { data } = await axios.post(`${API_BASE}/cards`, null, {
    params: {
      ...credentials(),
      idList: listId,
      name,
      pos: "bottom",
    },
  });
  return data;
}

async function setTodoCardCompletion(cardId, complete, allowedListIds) {
  const card = await fetchCard(cardId);
  assertAllowedList(card.idList, allowedListIds);

  if (!card.closed && card.dueComplete !== complete) {
    await axios.put(`${API_BASE}/cards/${cardId}`, null, {
      params: { ...credentials(), dueComplete: complete },
    });
  }
}

async function reorderTodoCards(listId, cardIds) {
  const cards = await fetchTodoCards(listId);
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const uniqueIds = new Set(cardIds);

  if (
    uniqueIds.size !== cardIds.length ||
    cardIds.some(
      (cardId) => !cardsById.has(cardId) || cardsById.get(cardId).dueComplete,
    )
  ) {
    const error = new Error("Invalid card order");
    error.status = 400;
    throw error;
  }

  for (const [index, cardId] of cardIds.entries()) {
    await axios.put(`${API_BASE}/cards/${cardId}`, null, {
      params: { ...credentials(), pos: (index + 1) * 16384 },
    });
  }
}

module.exports = {
  BOARD_ID,
  DEFAULT_LIST_ID,
  createTodoCard,
  fetchTodoCards,
  fetchTodoLists,
  reorderTodoCards,
  setTodoCardCompletion,
};
