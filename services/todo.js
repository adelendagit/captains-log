const axios = require("axios");

const BOARD_ID = process.env.TRELLO_BOARD_ID || "BUk0xpGt";
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

async function fetchBoardLists() {
  const { data } = await axios.get(`${API_BASE}/boards/${BOARD_ID}/lists`, {
    params: {
      ...credentials(),
      filter: "open",
      fields: "id,name,pos",
    },
  });

  return data.sort((a, b) => a.pos - b.pos);
}

async function fetchTodoBoards() {
  const { data } = await axios.get(`${API_BASE}/members/me/boards`, {
    params: {
      ...credentials(),
      filter: "open",
      fields: "id,name",
      lists: "open",
      list_fields: "id,name,pos",
    },
  });

  return data
    .map((board) => ({
      id: board.id,
      name: board.name,
      lists: (board.lists || [])
        .sort((a, b) => a.pos - b.pos)
        .map((list) => ({
          ...list,
          boardId: board.id,
          boardName: board.name,
        })),
    }))
    .sort((left, right) => {
      if (left.id === BOARD_ID) return -1;
      if (right.id === BOARD_ID) return 1;
      return left.name.localeCompare(right.name);
    });
}

function defaultTodoLists(lists) {
  const todayIndex = lists.findIndex(
    (list) => list.name.trim().toLowerCase() === "today",
  );
  if (todayIndex === -1) {
    const defaultList = lists.find((list) => list.id === DEFAULT_LIST_ID);
    return defaultList ? [defaultList] : lists.slice(0, 1);
  }

  return lists.slice(0, todayIndex + 1);
}

async function fetchTodoLists() {
  return defaultTodoLists(await fetchBoardLists());
}

async function fetchTodoCards(listId = DEFAULT_LIST_ID) {
  const { data } = await axios.get(`${API_BASE}/lists/${listId}/cards`, {
    params: {
      ...credentials(),
      filter: "open",
      fields: "id,name,desc,due,dueComplete,labels,pos,shortUrl",
      attachments: true,
      attachment_fields: "id,name,url,mimeType,previews",
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

async function updateTodoCard(cardId, name, desc, allowedListIds) {
  const card = await fetchCard(cardId);
  assertAllowedList(card.idList, allowedListIds);

  if (card.closed) {
    const error = new Error("Closed cards cannot be edited");
    error.status = 400;
    throw error;
  }

  const { data } = await axios.put(`${API_BASE}/cards/${cardId}`, null, {
    params: { ...credentials(), name, desc },
  });
  return data;
}

async function archiveTodoCard(cardId, allowedListIds) {
  const card = await fetchCard(cardId);
  assertAllowedList(card.idList, allowedListIds);

  if (!card.closed) {
    await axios.put(`${API_BASE}/cards/${cardId}`, null, {
      params: { ...credentials(), closed: true },
    });
  }
}

async function addTodoCardAttachment(
  cardId,
  { buffer, filename, mimeType },
  allowedListIds,
) {
  const card = await fetchCard(cardId);
  assertAllowedList(card.idList, allowedListIds);

  if (card.closed) {
    const error = new Error("Closed cards cannot receive attachments");
    error.status = 400;
    throw error;
  }

  const form = new FormData();
  form.append("key", credentials().key);
  form.append("token", credentials().token);
  form.append("name", filename);
  form.append("file", new Blob([buffer], { type: mimeType }), filename);
  const { data } = await axios.post(
    `${API_BASE}/cards/${cardId}/attachments`,
    form,
  );
  return data;
}

async function downloadTodoCardAttachment(
  cardId,
  attachmentId,
  allowedListIds,
) {
  const card = await fetchCard(cardId);
  assertAllowedList(card.idList, allowedListIds);

  const { data: attachment } = await axios.get(
    `${API_BASE}/cards/${cardId}/attachments/${attachmentId}`,
    { params: credentials() },
  );
  const attachmentUrl = new URL(attachment.url);
  if (
    !attachment.mimeType?.startsWith("image/") ||
    (attachmentUrl.hostname !== "trello.com" &&
      !attachmentUrl.hostname.endsWith(".trello.com"))
  ) {
    const error = new Error("Attachment is not a Trello-hosted image");
    error.status = 404;
    throw error;
  }
  const response = await axios.get(attachment.url, {
    params: credentials(),
    responseType: "arraybuffer",
  });
  return {
    data: response.data,
    mimeType: attachment.mimeType || response.headers["content-type"],
  };
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
  addTodoCardAttachment,
  archiveTodoCard,
  createTodoCard,
  downloadTodoCardAttachment,
  defaultTodoLists,
  fetchBoardLists,
  fetchTodoBoards,
  fetchTodoCards,
  fetchTodoLists,
  reorderTodoCards,
  setTodoCardCompletion,
  updateTodoCard,
};
