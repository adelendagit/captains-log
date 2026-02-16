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

## Proposed Location-Aware Log Entry Flow

To support the workflow "if moving, use GPS coordinates; if at port, suggest nearby places and let the user confirm", the cleanest approach is to split this into two APIs: one for **context detection + suggestions**, and one for **comment submission**.

### 1) Context API (`POST /api/log-context`)

This endpoint accepts the live device position and returns:

- whether the vessel is currently `underway` or `arrived` (using the same status logic as `/api/current-stop`),
- the nearest candidate cards,
- a ready-to-use payload template for comment submission.

#### Request body

```json
{
  "lat": 36.1408,
  "lng": -5.3536,
  "speedKts": 4.2,
  "limit": 5
}
```

- `lat` and `lng` are required.
- `speedKts` is optional but recommended to improve underway detection.
- `limit` defaults to `5` for UI selection lists.

#### Response shape

```json
{
  "mode": "underway",
  "status": {
    "current": "underway",
    "departedAt": "2026-02-12T09:35:00.000Z"
  },
  "suggestions": [
    {
      "id": "trelloCardId",
      "name": "Gibraltar",
      "distanceKm": 1.8,
      "list": "Spain"
    }
  ],
  "draft": {
    "action": "departed",
    "cardId": null,
    "lat": 36.1408,
    "lng": -5.3536,
    "timestamp": "2026-02-12T09:41:12.000Z"
  }
}
```

Behavior:

- **Underway**: return `mode: "underway"` and a draft that preserves raw lat/lng.
- **Arrived / in port**: return `mode: "port"` with closest-card suggestions so the user can select the correct place.

### 2) Submission API (`POST /api/log-entry`)

This endpoint receives the user-confirmed selection and writes a Trello comment.

#### Request body

```json
{
  "action": "arrived",
  "cardId": "trelloCardId",
  "lat": 36.1408,
  "lng": -5.3536,
  "timestamp": "2026-02-12T09:41:12.000Z",
  "source": "mobile"
}
```

#### Comment format recommendation

Keep comments parseable and backwards-compatible with existing `arrived` / `departed` matching:

```text
arrived
timestamp: 2026-02-12T09:41:12.000Z
lat: 36.1408
lng: -5.3536
source: mobile
```

This still starts with `arrived`/`departed`, so existing regex logic continues to work while adding structured metadata for future automation.

### 3) UI flow recommendation

1. Capture device geolocation (+ speed when available).
2. Call `POST /api/log-context`.
3. If mode is `underway`, show a "Use current position" confirmation card.
4. If mode is `port`, show top nearest suggestions (radio list) plus a "None of these" fallback.
5. On confirm, call `POST /api/log-entry`.

### 4) Edge cases

- If no nearby cards are found, allow manual card search.
- If geolocation permission is denied, allow purely manual selection.
- If status is ambiguous, default to `port` mode and ask the user to choose action (`arrived` vs `departed`).
- Always keep final user confirmation before posting a comment.
