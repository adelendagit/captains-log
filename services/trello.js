const axios = require('axios');
const BOARD_ID   = process.env.TRELLO_BOARD_ID;
const KEY        = process.env.TRELLO_KEY;
const TOKEN      = process.env.TRELLO_TOKEN;

const BASE_URL = `https://api.trello.com/1/boards/${BOARD_ID}`;
const QUERY    = `?key=${KEY}&token=${TOKEN}`
  + `&cards=all&card_customFieldItems=true&lists=all&fields=all`
  + `&customFields=true`;

async function fetchBoard() {
  const { data } = await axios.get(BASE_URL + QUERY);
  return data;
}

module.exports = { fetchBoard };
