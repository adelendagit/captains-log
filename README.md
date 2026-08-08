# Skibidi

This project now supports optional Trello authentication so that users can sign in with their Trello accounts. Without signing in the app continues to show read‑only board data; after authentication it will have read/write access to the user's Trello data which will enable future editing features.

## Runtime

The application targets Node.js 24 LTS. With `nvm`, run `nvm use` from the
project directory to install/select the version declared in `.nvmrc`.

## Closest Locations API

The application exposes an `/api/closest-locations` endpoint that returns the Trello cards nearest to a given latitude and longitude.

### Request

Send a `GET` request to `/api/closest-locations` with the following query parameters:

| Parameter                    | Required | Description                                                                                          |
| ---------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `lat` / `latitude`           | Yes      | Latitude in decimal degrees for the point you want to search from. Either name is accepted.          |
| `long` / `lng` / `longitude` | Yes      | Longitude in decimal degrees for the point you want to search from. Any of the aliases are accepted. |
| `apiKey`                     | Yes      | Trello API key that has read access to the target board.                                             |
| `token`                      | Yes      | Trello API token associated with the key.                                                            |
| `limit`                      | No       | Maximum number of locations to return. Must be a positive integer. Defaults to `1`.                  |

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
# Used for board data. The token needs write access for the public to-do page.
TRELLO_KEY=<your trello api key>
TRELLO_TOKEN=<trello token with read/write access>
TRELLO_BOARD_ID=<board id>
TRELLO_JOURNEYS_LIST_ID=6a704f2decc154fd0a4b8550

# Used for Trello OAuth login
TRELLO_OAUTH_KEY=<your trello OAuth key>
TRELLO_OAUTH_SECRET=<your trello OAuth secret>

# Session/host configuration
SESSION_SECRET=<session secret>
# Preferred production session store. Railway's private REDIS_URL is supported.
REDIS_URL=redis://default:password@redis.railway.internal:6379
# Optional file-store fallback when REDIS_URL is absent.
SESSION_DIR=/var/lib/captains-log/sessions

# Optional email notifications via Resend
RESEND_API_KEY=<your Resend API key>
EMAIL_FROM=updates@your-verified-domain.example
EMAIL_REPLY_TO=<address used for replies and test notifications>
EMAIL_RECIPIENTS_JSON={"Family":"family@example.com","Crew":"crew@example.com"}
PUBLIC_SITE_URL=https://where.is.achilleas.co.uk
# Optional; defaults to Europe/Athens when formatting email timestamps
EMAIL_TIME_ZONE=Europe/Athens
```

`EMAIL_RECIPIENTS` may be used instead of `EMAIL_RECIPIENTS_JSON` as a
comma-separated list. Email addresses remain server-side and are never sent to
the browser.

## Authentication

If `TRELLO_OAUTH_KEY` and `TRELLO_OAUTH_SECRET` are provided you can navigate to `/auth/trello` to start the OAuth flow. After authorizing, Trello will redirect back to `/auth/trello/callback` and your session will be authenticated.

New Trello authorizations request `expiration=never`, so the Trello token does
not expire on a timer. A token can still stop working if the member revokes the
application in Trello or if Trello invalidates it. Authorizations created before
this setting was deployed retain their original expiry and must be renewed once.

Login cookies use the browser-supported 400-day maximum and are renewed on
every visit, making active logins effectively indefinite. When `REDIS_URL` is
set, Express sessions are stored in Redis and the server waits for Redis before
accepting requests. Keep `SESSION_SECRET` and the Redis data unchanged between
releases. Redis must have persistence configured if sessions should survive a
restart of the Redis service itself. Without `REDIS_URL`, development falls back
to `SESSION_DIR`. A user who does not visit for more than 400 days or clears
browser data will need to sign in again.

## Live Journeys

Live tracking uses Trello as its only persistence layer. Starting a journey creates
a card in the `Journeys` list. The card description stores the journey state and
each accepted GPS sample is stored as a structured `position` comment.

Authenticated Trello board members can use:

- `POST /api/journeys/start` with an optional `{ "name": "..." }`
- `POST /api/journeys/:cardId/positions` with latitude, longitude, timestamp,
  accuracy, speed in knots, course, altitude and a unique sample ID
- `POST /api/journeys/:cardId/end`

`GET /api/journeys/current` is public and returns the active journey, its latest
position and up to 100 recent track points. The chartroom polls this endpoint every
30 seconds.

The native SwiftUI project is at `ios/CaptainsLog.xcodeproj`. It signs in through
the existing Trello OAuth flow, stores its encrypted app credential in the iOS
Keychain, uploads at most one GPS position per minute, and queues up to 200 samples
when offline. Open the project in Xcode, select a development team for the
`CaptainsLog` target, and run it on an iPhone. Background GPS should be verified on
a physical device before relying on it for a voyage.

## Adding Places from Navily

Authenticated board members can create a place with `POST /api/places`. The
request must include `name`, `listId`, `lat`, `lng`, and a `navilyUrl`; an
optional `description` is stored on the Trello card. The endpoint validates the
destination list, rejects duplicate canonical Navily links, creates the card,
and populates the board's `Latitude`, `Longitude`, and `Navily` custom fields.

The iOS Planning screen exposes the same flow through its Add Place button. A
Navily link can be pasted into the form, and the place position can be entered
as decimal coordinates or selected by tapping the map. The bundled “Add to
Captain’s Log” Share Extension presents this same form for URLs shared by
Navily or Safari. Shared text containing Navily's degrees-and-decimal-minutes
coordinates is converted to decimal degrees automatically.

The app and Share Extension share the mobile credential through the Keychain.
Physical-device signing therefore requires the
`co.uk.achilleas.CaptainsLog.shared` Keychain Sharing group on both targets.

## Public To-do Page

`/to-do` lists open cards in Trello list `62b3554c15a79549f9f3f52d` on board `BUk0xpGt`. Cards can be reordered, marked done, and restored without being archived. The page is intentionally absent from site navigation and does not require authentication, so anyone who knows the URL can update cards in that list. Authenticated users can also add items and switch between the board's open lists, in Trello order, up to and including `Today`.

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
