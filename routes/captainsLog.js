const express = require('express');
const router  = express.Router();
const { fetchBoard } = require('../services/trello');

// existing number helper
function getCFNumber(card, boardCFs, name) {
  const def  = boardCFs.find(f => f.name === name);
  const item = card.customFieldItems.find(i => i.idCustomField === def.id);
  return item?.value?.number ? Number(item.value.number) : null;
}
// updated text/dropdown helper:
function getCFTextOrDropdown(card, boardCFs, name) {
  const def  = boardCFs.find(f => f.name === name);
  if (!def) return null;
  const item = card.customFieldItems.find(i => i.idCustomField === def.id);
  if (!item) return null;

  // If it's a text field:
  if (item.value?.text != null) {
    return item.value.text;
  }

  // If it's a dropdown, Trello gives you idValue:
  if (item.idValue && Array.isArray(def.options)) {
    const opt = def.options.find(o => o.id === item.idValue);
    return opt?.value?.text ?? null;
  }

  return null;
}

router.get('/api/data', async (req, res, next) => {
  try {
    const { cards, lists, customFields } = await fetchBoard();

    console.log('Custom field definitions:', customFields.map(f => f.name));

    const tripsListId = lists.find(l => l.name === 'Trips').id;
    console.log('Trips list ID:', tripsListId);

    // map of list IDs → names
    const listNames = Object.fromEntries(lists.map(l=>[l.id,l.name]));

    const stops = cards
      .filter(c => c.due && c.idList !== tripsListId)
      .map(c => {
        const ratingText = getCFTextOrDropdown(c, customFields, '⭐️');
        const ratingNum  = ratingText != null ? parseInt(ratingText, 10) : null;
        console.log(`Card "${c.name}" → dropdown text:`, ratingText);

        return {
          id:          c.id,
          name:        c.name,
          listName:    listNames[c.idList],
          due:         c.due,
          dueComplete: c.dueComplete,
          lat:         getCFNumber(c, customFields, 'Latitude'),
          lng:         getCFNumber(c, customFields, 'Longitude'),
          rating:      ratingNum,
          trelloUrl:   c.shortUrl,
          navilyUrl:   getCFTextOrDropdown(c, customFields, 'Navily')
        };
      })
      .sort((a,b) => new Date(a.due) - new Date(b.due));

    const places = cards
      .filter(c =>
        !c.due &&
        c.idList !== tripsListId &&
        getCFNumber(c, customFields, 'Latitude') != null &&
        getCFNumber(c, customFields, 'Longitude') != null
      )
      .map(c => {
        const ratingText = getCFTextOrDropdown(c, customFields, '⭐️');
        return {
          id:        c.id,
          name:      c.name,
          listName:  listNames[c.idList],
          lat:       getCFNumber(c, customFields, 'Latitude'),
          lng:       getCFNumber(c, customFields, 'Longitude'),
          rating:    ratingText !== null ? parseInt(ratingText,10) : null,
          trelloUrl: c.shortUrl
        };
      });

    res.json({ stops, places });
  } catch(err) {
    next(err);
  }
});


// existing render route
router.get('/captains-log', async (req, res, next) => {
  try {
    const board = await fetchBoard();
    const { cards, lists, customFields } = board;

    // compute planningStops & historical exactly as before
    const planningStops = cards
      .filter(c => c.due)
      .map(c => ({
        id:   c.id,
        name: c.name,
        due:  c.due,
        lat:  getCFNumber(c, customFields, 'Latitude'),
        lng:  getCFNumber(c, customFields, 'Longitude')
      }))
      .sort((a,b) => new Date(a.due) - new Date(b.due));

    const tripsList = lists.find(l => l.name === 'Trips');
    const trips = cards
      .filter(c => c.idList === tripsList.id)
      .map(c => ({
        name:  c.name,
        start: c.start,
        due:   c.due
      }));
    const byYear = trips.reduce((acc, t) => {
      const year = (t.start || t.due || '').slice(0,4) || 'No Date';
      (acc[year] = acc[year]||[]).push(t);
      return acc;
    }, {});
    const historical = Object.entries(byYear)
      .map(([year, arr]) => ({ year, trips: arr }))
      .sort((a,b) => b.year.localeCompare(a.year));

    res.render('captains-log', { planningStops, historical });
  } catch(err) {
    next(err);
  }
});

module.exports = router;
