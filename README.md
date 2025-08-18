# Captain's Log

This project now supports Trello authentication so that users can sign in with their Trello accounts. After authentication the application will have read/write access to the user's Trello data which will enable future editing features.

## Environment Variables

Set the following variables in a `.env` file or your environment:

```
TRELLO_KEY=<your trello api key>
TRELLO_SECRET=<your trello api secret>
TRELLO_BOARD_ID=<board id>
SESSION_SECRET=<session secret>
BASE_URL=http://localhost:3000
```

## Authentication

Navigate to `/auth/trello` to start the OAuth flow. After authorizing, Trello will redirect back to `/auth/trello/callback` and your session will be authenticated.
