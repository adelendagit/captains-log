# Captain's Log

This project now supports optional Trello authentication so that users can sign in with their Trello accounts. Without signing in the app continues to show read‑only board data; after authentication it will have read/write access to the user's Trello data which will enable future editing features.

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
BASE_URL=http://localhost:3000
```

## Authentication

If `TRELLO_OAUTH_KEY` and `TRELLO_OAUTH_SECRET` are provided you can navigate to `/auth/trello` to start the OAuth flow. After authorizing, Trello will redirect back to `/auth/trello/callback` and your session will be authenticated.
