# Captain's Log

This project now supports optional Trello authentication so that users can sign in with their Trello accounts. Without signing in the app continues to show read‑only board data; after authentication it will have read/write access to the user's Trello data which will enable future editing features.

## Closest Locations API

The application exposes an `/api/closest-locations` endpoint that returns the Trello cards nearest to a given latitude and longitude.

### Request

Send a `GET` request to `/api/closest-locations` with the following query parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `lat` / `latitude` | Yes | Latitude in decimal degrees for the point you want to search from. Either name is accepted. |
| `long` / `lng` / `longitude` | Yes | Longitude in decimal degrees for the point you want to search from. Any of the aliases are accepted. |
| `apiKey` | Yes | Trello API key that has read access to the target board. |
| `token` | Yes | Trello API token associated with the key. |
| `limit` | No | Maximum number of locations to return. Must be a positive integer. Defaults to `1`. |

### Response

The endpoint returns a JSON payload containing the closest card(s) that have both `Latitude` and `Longitude` custom fields populated on the Trello board:

```json
{
  "locations": [
    {
      "id": "<card id>",
      "name": "<card name>",
      "url": "https://trello.com/c/...",
      "list": "<list name>",
      "desc": "<card description>"
    }
  ]
}
```

Cards are returned in ascending order by distance from the provided coordinates, so the first entry is the closest match.

### Example

```bash
curl "http://localhost:3000/api/closest-locations?lat=48.8566&long=2.3522&limit=3" \
  --get \
  --data-urlencode "apiKey=$TRELLO_KEY" \
  --data-urlencode "token=$TRELLO_TOKEN"
```

If the request is successful you will receive the nearest three cards that have valid location custom fields. A `400` status code indicates missing or invalid query parameters, while a `500` status code indicates the Trello board is not configured with both `Latitude` and `Longitude` custom fields.

## Environment Variables

Set the following variables in a `.env` file or your environment:

```
# Used for fetching read‑only board data
TRELLO_KEY=<your trello api key>
TRELLO_TOKEN=<trello token with read access>
TRELLO_BOARD_ID=<board id>

# Used for Trello OAuth login
TRELLO_OAUTH_KEY=<your trello OAuth key>
TRELLO_OAUTH_SECRET=<your trello OAuth secret>

# Session/host configuration
SESSION_SECRET=<session secret>
```

## Authentication

If `TRELLO_OAUTH_KEY` and `TRELLO_OAUTH_SECRET` are provided you can navigate to `/auth/trello` to start the OAuth flow. After authorizing, Trello will redirect back to `/auth/trello/callback` and your session will be authenticated.
