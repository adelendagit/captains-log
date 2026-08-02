const axios = require("axios");

const BOARD_ID = "BUk0xpGt";
const LIST_ID = "62b3554c15a79549f9f3f52d";
const KEY = process.env.TRELLO_KEY;
const TOKEN = process.env.TRELLO_TOKEN;
const API_BASE = "https://api.trello.com/1";

function credentials() {
  if (!KEY || !TOKEN) {
    throw new Error("Trello server credentials are not configured");
  }
  return { key: KEY, token: TOKEN };
}

async function fetchOpenTodoCards() {
  const { data } = await axios.get(`${API_BASE}/lists/${LIST_ID}/cards`, {
    params: {
      ...credentials(),
      filter: "open",
      fields: "id,name,desc,due,dueComplete,labels,pos,shortUrl",
    },
  });

  return data.filter((card) => !card.dueComplete).sort((a, b) => a.pos - b.pos);
}

async function markTodoCardDone(cardId) {
  const { data: card } = await axios.get(`${API_BASE}/cards/${cardId}`, {
    params: {
      ...credentials(),
      fields: "id,idList,closed,dueComplete",
    },
  });

  if (card.idList !== LIST_ID) {
    const error = new Error(
      "Card does not belong to the configured to-do list",
    );
    error.status = 404;
    throw error;
  }

  if (!card.closed && !card.dueComplete) {
    await axios.put(`${API_BASE}/cards/${cardId}`, null, {
      params: { ...credentials(), dueComplete: true },
    });
  }
}

module.exports = {
  BOARD_ID,
  LIST_ID,
  fetchOpenTodoCards,
  markTodoCardDone,
};
