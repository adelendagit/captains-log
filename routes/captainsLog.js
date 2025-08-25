const express = require('express');
const router  = express.Router();
const axios = require('axios');
const { fetchBoard, fetchAllComments, fetchBoardWithAllComments } = require('../services/trello');

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
    const { cards, lists, customFields, members } = await fetchBoard();

    console.log('Custom field definitions:', customFields.map(f => f.name));

    const tripsListId = lists.find(l => l.name === 'Trips').id;
    console.log('Trips list ID:', tripsListId);

    // map of list IDs → names
    const listNames = Object.fromEntries(lists.map(l=>[l.id,l.name]));

    const colorMap = {
      green:  '#61bd4f',
      yellow: '#f2d600',
      orange: '#ff9f1a',
      red:    '#eb5a46',
      purple: '#c377e0',
      blue:   '#0079bf',
      sky:    '#00c2e0',
      lime:   '#51e898',
      pink:   '#ff78cb',
      black:  '#344563'
    };

    const stops = cards
      .filter(c => c.due && c.idList !== tripsListId)
      .map(c => {
        const ratingText = getCFTextOrDropdown(c, customFields, '⭐️');
        const ratingNum  = ratingText != null ? parseInt(ratingText, 10) : null;
        console.log(`Card "${c.name}" → dropdown text:`, ratingText);

        const labels = (c.labels || []).map(l => ({
          name: l.name,
          color: colorMap[l.color] || '#888'
        }));

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
          navilyUrl:   getCFTextOrDropdown(c, customFields, 'Navily'),
          labels
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
        const labels = (c.labels || []).map(l => ({
          name: l.name,
          color: colorMap[l.color] || '#888'
        }));
        return {
          id:        c.id,
          name:      c.name,
          listName:  listNames[c.idList],
          lat:       getCFNumber(c, customFields, 'Latitude'),
          lng:       getCFNumber(c, customFields, 'Longitude'),
          rating:    ratingText !== null ? parseInt(ratingText,10) : null,
          trelloUrl: c.shortUrl,
          labels
        };
      });

      // Determine if user can plan
      let canPlan = false;
      if (req.user && members) {
        const userId = req.user.id || req.user.idMember || (req.user.profile && req.user.profile.id);
        canPlan = members.some(m => m.id === userId && (m.memberType === 'admin' || m.memberType === 'normal'));
      }
      
      // Helper to extract timestamp from comment text
      function extractTimestamp(text, fallback) {
        let match = text.match(/timestamp:\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/i);
        if (!match) {
          match = text.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/);
        }
        if (match) {
          const ts = match[1].trim().replace(' ', 'T');
          const d = new Date(ts.length === 16 ? ts + ':00' : ts); // add seconds if missing
          if (!isNaN(d)) return d.toISOString();
        }
        return fallback;
      }

    res.json({ stops, places, canPlan });
  } catch(err) {
    next(err);
  }
});

router.get('/api/logs', async (req, res, next) => {
  try {
    const board = await fetchBoardWithAllComments();
    const { cards, lists, customFields, allComments } = board;
    const listNames = Object.fromEntries(lists.map(l=>[l.id,l.name]));

    function getCFNumber(card, boardCFs, name) {
      const def  = boardCFs.find(f => f.name === name);
      if (!def) return null;
      const item = card.customFieldItems.find(i => i.idCustomField === def.id);
      return item?.value?.number ? Number(item.value.number) : null;
    }
    function getCFTextOrDropdown(card, boardCFs, name) {
      const def  = boardCFs.find(f => f.name === name);
      if (!def) return null;
      const item = card.customFieldItems.find(i => i.idCustomField === def.id);
      if (!item) return null;
      if (item.value?.text != null) return item.value.text;
      if (item.idValue && Array.isArray(def.options)) {
        const opt = def.options.find(o => o.id === item.idValue);
        return opt?.value?.text ?? null;
      }
      return null;
    }
    function extractTimestamp(text, fallback) {
      let match = text.match(/timestamp:\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/i);
      if (!match) {
        match = text.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/);
      }
      if (match) {
        const ts = match[1].trim().replace(' ', 'T');
        const d = new Date(ts.length === 16 ? ts + ':00' : ts);
        if (!isNaN(d)) return d.toISOString();
      }
      return fallback;
    }

    // Get trips from cards in the Trips list
    const tripsList = lists.find(l => l.name === 'Trips');
    const trips = cards
      .filter(c => c.idList === tripsList.id)
      .map(c => ({
        name:  c.name,
        start: c.start,
        due:   c.due
      }))
      .filter(t => t.start)
      .sort((a, b) => new Date(b.start) - new Date(a.start));

    // Find most recent trip
    const mostRecentTrip = trips[0];

    const logs = allComments
      .filter(a => a.type === 'commentCard' && a.data && a.data.text)
      .map(a => {
        const text = a.data.text;
        let type = null;
        if (/^arrived\b/i.test(text)) type = "Arrived";
        if (/^departed\b/i.test(text)) type = "Departed";
        if (!type) return null;
        const card = cards.find(c => c.id === a.data.card.id);
        const timestamp = extractTimestamp(text, a.date);
        return {
          area: card && card.idList ? listNames[card.idList] : "Unknown",
          cardName: card ? card.name : (a.data.card.name || "Unknown"),
          type,
          timestamp,
          comment: text,
          cardId: a.data.card.id,
          trelloUrl: card ? card.shortUrl : undefined,
          lat: card ? getCFNumber(card, customFields, 'Latitude') : null,
          lng: card ? getCFNumber(card, customFields, 'Longitude') : null,
          rating: card ? (() => {
            const ratingText = getCFTextOrDropdown(card, customFields, '⭐️');
            return ratingText != null ? parseInt(ratingText, 10) : null;
          })() : null,
          navilyUrl: card ? getCFTextOrDropdown(card, customFields, 'Navily') : null
        };
      })
      .filter(Boolean);

      let filteredLogs = logs; // <--- ADD THIS LINE

      // If trip=all, return all logs
      if (req.query.trip === 'all') {
        // no filter
      }
      // If start/end are provided, filter by those
      else if (req.query.start) {
        const start = new Date(req.query.start);
        const end = req.query.end ? new Date(req.query.end) : null;
        filteredLogs = logs.filter(l => {
          const d = new Date(l.timestamp);
          return d >= start && (!end || d <= end);
        });
      }
      // Otherwise, default to most recent trip
      else if (mostRecentTrip) {
        const start = new Date(mostRecentTrip.start);
        const end = mostRecentTrip.due ? new Date(mostRecentTrip.due) : null;
        filteredLogs = logs.filter(l => {
          const d = new Date(l.timestamp);
          return d >= start && (!end || d <= end);
        });
      }

    // In routes/captainsLog.js, inside router.get('/api/logs', ...)
    const mostRecentTripRange = mostRecentTrip
      ? { start: mostRecentTrip.start, end: mostRecentTrip.due }
      : null;

    res.json({ logs: filteredLogs, mostRecentTripRange });
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

    res.render('captains-log', { planningStops, historical, user: req.user });
  } catch(err) {
    next(err);
  }
});

router.post('/api/plan-stop', async (req, res, next) => {
  try {
    if (!req.user) return res.status(403).json({ error: 'Not authenticated' });
    // Optionally, check if user is a board member/admin here

    const { cardId, due } = req.body;
    console.log('Planning stop:', cardId, due);
    // Update the card's due date via Trello API
    const oauth = {
      consumer_key: process.env.TRELLO_OAUTH_KEY,
      consumer_secret: process.env.TRELLO_OAUTH_SECRET,
      token: req.user.token,
      token_secret: req.user.tokenSecret,
    };

    const url = `https://api.trello.com/1/cards/${cardId}/due`;

    const oauth1a = require('oauth-1.0a');
    const crypto = require('crypto');

    // Create OAuth1.0a signature
    const oauthClient = oauth1a({
      consumer: { key: oauth.consumer_key, secret: oauth.consumer_secret },
      signature_method: 'HMAC-SHA1',
      hash_function(base_string, key) {
        return crypto.createHmac('sha1', key).update(base_string).digest('base64');
      },
    });

    const request_data = {
      url,
      method: 'PUT',
      data: { value: due },
    };

    const headers = oauthClient.toHeader(
      oauthClient.authorize(request_data, {
        key: oauth.token,
        secret: oauth.token_secret,
      })
    );

    await axios.put(
      url,
      null,
      {
        params: { value: due },
        headers,
      }
    );
    res.json({ success: true });
  } catch (err) {
    console.log('Error in /api/plan-stop:', err);
    next(err);
  }
});

router.post('/api/remove-stop', async (req, res, next) => {
  try {
    if (!req.user) return res.status(403).json({ error: 'Not authenticated' });

    const { cardId } = req.body;
    if (!cardId) return res.status(400).json({ error: 'Missing cardId' });

    // Use user's Trello OAuth credentials as in /api/plan-stop
    const oauth = {
      consumer_key: process.env.TRELLO_OAUTH_KEY,
      consumer_secret: process.env.TRELLO_OAUTH_SECRET,
      token: req.user.token,
      token_secret: req.user.tokenSecret,
    };

    const url = `https://api.trello.com/1/cards/${cardId}/due`;

    const oauth1a = require('oauth-1.0a');
    const crypto = require('crypto');

    const oauthClient = oauth1a({
      consumer: { key: oauth.consumer_key, secret: oauth.consumer_secret },
      signature_method: 'HMAC-SHA1',
      hash_function(base_string, key) {
        return crypto.createHmac('sha1', key).update(base_string).digest('base64');
      },
    });

    const request_data = {
      url,
      method: 'PUT',
      data: { value: null },
    };

    const headers = oauthClient.toHeader(
      oauthClient.authorize(request_data, {
        key: oauth.token,
        secret: oauth.token_secret,
      })
    );

    // Set due to null to "unplan" the stop
    await axios.put(
      url,
      null,
      {
        params: { value: null },
        headers,
      }
    );
    res.json({ success: true });
  } catch (err) {
    console.log('Error in /api/remove-stop:', err);
    next(err);
  }
});

router.post('/api/reorder-stops', async (req, res, next) => {
  try {
    if (!req.user) return res.status(403).json({ error: 'Not authenticated' });
    const { updates } = req.body;
    if (!Array.isArray(updates)) return res.status(400).json({ error: 'Invalid updates' });

    const oauth = {
      consumer_key: process.env.TRELLO_OAUTH_KEY,
      consumer_secret: process.env.TRELLO_OAUTH_SECRET,
      token: req.user.token,
      token_secret: req.user.tokenSecret,
    };
    const oauth1a = require('oauth-1.0a');
    const crypto = require('crypto');
    const oauthClient = oauth1a({
      consumer: { key: oauth.consumer_key, secret: oauth.consumer_secret },
      signature_method: 'HMAC-SHA1',
      hash_function(base_string, key) {
        return crypto.createHmac('sha1', key).update(base_string).digest('base64');
      },
    });

    // Update each card's due date
    for (const { cardId, due } of updates) {
      const url = `https://api.trello.com/1/cards/${cardId}/due`;
      const request_data = { url, method: 'PUT', data: { value: due } };
      const headers = oauthClient.toHeader(
        oauthClient.authorize(request_data, {
          key: oauth.token,
          secret: oauth.token_secret,
        })
      );
      console.log('Reordering stop:', cardId, due);
      console.log(`https://trello.com/c/${cardId}`);
      const response = await axios.put(url, null, { params: { value: due }, headers });
      console.log('Trello API response:', response.data);
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
