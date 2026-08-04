const axios = require("axios");

const BOARD_ID = process.env.TRELLO_BOARD_ID;
const KEY = process.env.TRELLO_KEY;
const TOKEN = process.env.TRELLO_TOKEN;

const BASE_URL = `https://api.trello.com/1/boards/${BOARD_ID}`;
const COMMON_QUERY =
  `&cards=open&card_fields=id,name,desc,idList,due,dueComplete,start,labels,shortUrl,closed` +
  `&card_customFieldItems=true&lists=open&list_fields=id,name,closed&fields=id` +
  `&customFields=true&members=all&labels=all&label_fields=id,name,color`;

const BOARD_CACHE_TTL_MS = 60_000;
let boardCache = null;
let boardCacheExpiresAt = 0;
let boardRequest = null;

function filterCardsToOpenLists(board) {
  const openListIds = new Set(board.lists.map((list) => list.id));
  board.cards = board.cards.filter((card) => openListIds.has(card.idList));
}

function buildQuery(key, token) {
  return `?key=${key}&token=${token}${COMMON_QUERY}`;
}

async function fetchBoard() {
  if (boardCache && Date.now() < boardCacheExpiresAt) return boardCache;
  if (boardRequest) return boardRequest;

  boardRequest = axios
    .get(BASE_URL + buildQuery(KEY, TOKEN))
    .then(({ data }) => {
      filterCardsToOpenLists(data);
      boardCache = data;
      boardCacheExpiresAt = Date.now() + BOARD_CACHE_TTL_MS;
      return data;
    })
    .finally(() => {
      boardRequest = null;
    });

  return boardRequest;
}

function invalidateBoardCache() {
  boardCache = null;
  boardCacheExpiresAt = 0;
}

async function fetchBoardWithCredentials(key, token) {
  const { data } = await axios.get(BASE_URL + buildQuery(key, token));
  filterCardsToOpenLists(data);
  return data;
}

// Fetch a limited number of recent comments (actions)
async function fetchRecentComments(limit = 100) {
  const url =
    BASE_URL +
    `/actions?filter=commentCard&limit=${limit}&key=${KEY}&token=${TOKEN}`;
  const { data } = await axios.get(url);
  return data;
}

async function fetchAllComments() {
  let allActions = [];
  let before = null;
  let keepGoing = true;

  while (keepGoing) {
    const url =
      BASE_URL +
      `/actions?filter=commentCard&limit=1000${
        before ? `&before=${before}` : ""
      }&key=${KEY}&token=${TOKEN}`;
    const { data } = await axios.get(url);
    allActions = allActions.concat(data);

    if (data.length < 1000) {
      keepGoing = false;
    } else {
      before = data[data.length - 1].id;
    }
  }
  return allActions;
}

async function fetchCommentPage({ before = null, limit = 1000 } = {}) {
  const url =
    BASE_URL +
    `/actions?filter=commentCard&limit=${limit}${
      before ? `&before=${before}` : ""
    }&key=${KEY}&token=${TOKEN}`;
  const { data } = await axios.get(url);
  const done = data.length < limit;
  const nextBefore = done ? null : data[data.length - 1].id;
  return { data, done, nextBefore };
}

async function fetchBoardWithAllComments() {
  const { data: board } = await axios.get(BASE_URL + buildQuery(KEY, TOKEN));
  filterCardsToOpenLists(board);
  board.allComments = await fetchAllComments();
  return board;
}

module.exports = {
  fetchBoard,
  fetchAllComments,
  fetchBoardWithAllComments,
  fetchBoardWithCredentials,
  fetchCommentPage,
  fetchRecentComments,
  invalidateBoardCache,
};
