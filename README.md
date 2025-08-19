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
```

The application derives its base URL from incoming requests, so no `BASE_URL`
environment variable is required. The Trello login route builds the callback
URL from `req.protocol` and `req.get('host')`, ensuring Trello receives the
correct absolute URL for each request.

## Authentication

If `TRELLO_OAUTH_KEY` and `TRELLO_OAUTH_SECRET` are provided you can navigate to `/auth/trello` to start the OAuth flow. After authorizing, Trello will redirect back to `/auth/trello/callback` and your session will be authenticated.
