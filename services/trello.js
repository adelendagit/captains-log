const axios = require('axios');
const BOARD_ID   = process.env.TRELLO_BOARD_ID;
const KEY        = process.env.TRELLO_KEY;
const TOKEN      = process.env.TRELLO_TOKEN;

const BASE_URL = `https://api.trello.com/1/boards/${BOARD_ID}`;
const QUERY    = `?key=${KEY}&token=${TOKEN}`
  + `&cards=open&card_customFieldItems=true&lists=open&fields=all`
  + `&customFields=true&members=all&labels=all`;

function filterCardsToOpenLists(board) {
  const openListIds = new Set(board.lists.map(list => list.id));
  board.cards = board.cards.filter(card => openListIds.has(card.idList));
}

async function fetchBoard() {
  const { data } = await axios.get(BASE_URL + QUERY);
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
    const url = BASE_URL +
      `/actions?filter=commentCard&limit=1000${before ? `&before=${before}` : ''}&key=${KEY}&token=${TOKEN}`;
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

async function fetchBoardWithAllComments() {
  const { data: board } = await axios.get(BASE_URL + QUERY);
  filterCardsToOpenLists(board);
  board.allComments = await fetchAllComments();
  return board;
}

module.exports = {
  fetchBoard,
  fetchAllComments,
  fetchBoardWithAllComments,
  fetchRecentComments,
};