# Agent Genaie

Agent Genaie is a Next.js app for user onboarding, Firebase-backed login, Gmail OAuth connection, and internal service calls that send email through connected Gmail accounts.

## Routes

Public routes:

- `/login` supports Firebase Google Sign-In and passwordless email-link sign-in.
- `/auth/firebase/finish` completes Firebase email-link sign-in and creates the server session cookie.
- `/auth/session` creates or checks the Firebase-backed server session.
- `/auth/session/logout` clears the server session cookie.
- `/config/firebase` exposes the non-secret Firebase browser config.
- `/auth/google/callback` receives the Google OAuth callback.
- `/account-link/setup` shows the WhatsApp-to-login account linking page for a given invite token.
- `/job-scout/setup` shows the WhatsApp-to-login Job Scout setup page for a given invite token.
- `/privacy-policy` explains Webetu credential and Gmail permission usage.
- `/health` checks service health.

Protected routes require the `agent_genaie_session` cookie or a Firebase bearer token:

- `/{publicUserId}` signed-in dashboard launcher with service tabs.
- `/{publicUserId}/vault` signed-in Webetu credential vault.
- `/{publicUserId}/connect-gmail` authenticated Gmail connect/disconnect page.
- `/`, `/connect-gmail`, and `/vault` redirect signed-in users to their scoped `/{publicUserId}` route.
- `POST /auth/google/start` starts Gmail OAuth for the signed-in Firebase user.
- `GET /auth/google/status` checks Gmail connection for the signed-in Firebase user.
- `POST /auth/google/revoke` revokes and removes stored Gmail tokens for the signed-in Firebase user.
- `GET /account/status` returns the signed-in user's WhatsApp link and service status.
- `GET /webetu/credentials/status` checks whether the signed-in user has saved Webetu credentials.
- `POST /webetu/credentials` encrypts and saves the signed-in user's Webetu username/password.
- `POST /webetu/credentials/revoke` revokes the signed-in user's stored Webetu credentials.
- `POST /gmail/send` sends Gmail for the signed-in Firebase user only when `confirm` is `true`.
- `POST /account-link/setup/confirm` binds a pending account link invite to the signed-in user.
- `POST /job-scout/setup/confirm` binds a pending Job Scout invite to the signed-in user.

Internal routes require `Authorization: Bearer $AGENT_GENAI_INTERNAL_API_KEY`:

- `POST /internal/gmail/send` sends through a specified Gmail connection. Pass `senderUid` to send as a registered user, `useOwnerAuth: true` to use the owner fallback, or `senderKey` directly.
- `GET /internal/gmail/senders` lists registered users who have connected Gmail, without returning token data.
- `POST /internal/account-link/invite` creates a short-lived WhatsApp-to-login account link setup URL.
- `GET /internal/account-link/status` checks the current account link status for a phone number.
- `POST /internal/job-scout/invite` creates a short-lived WhatsApp-to-login Job Scout setup link.
- `POST /internal/job-scout/profile` saves WhatsApp-collected Job Scout preferences and a CV file reference.
- `GET /internal/job-scout/subscribers` lists Job Scout subscribers who are ready for application dispatch.
- `GET /internal/job-scout/applications` lists recorded Job Scout applications for one user.
- `POST /internal/job-scout/applications` records an applied, skipped, physical-submission, or failed Job Scout outcome.
- `GET /internal/webetu/restaurants` lists supported Webetu restaurant names.
- `GET /internal/webetu/preferences?phone=...` reads a linked user's Webetu restaurant preference.
- `POST /internal/webetu/preferences/default` saves a confirmed default restaurant for a linked WhatsApp phone.
- `POST /internal/webetu/preferences/override` saves a confirmed one-day restaurant override.
- `GET /internal/central-data/status` checks the Firestore central database connection.
- `POST /internal/central-data/backfill` syncs existing Firebase users and connected Gmail records into Firestore.

## Google Cloud

Create an OAuth web client and add this authorized redirect URI:

```text
https://your-agent-genaie-domain.example/auth/google/callback
```

The Gmail scope used by this app is send-only:

```text
https://www.googleapis.com/auth/gmail.send
```

## Firebase Auth

In Firebase Console:

1. Enable Authentication -> Sign-in method -> Email/Password -> Email link.
2. Enable Authentication -> Sign-in method -> Google.
3. Keep same-email account linking enabled so Google and email-link sign-ins attach to the same Firebase user when the email matches.
4. Add your app domain as an authorized domain.
5. Create a web app and copy its `apiKey`, `authDomain`, `projectId`, and `appId`.
6. Create a service account key JSON file from Project settings -> Service accounts.
7. Base64 encode the service account JSON:

```bash
base64 -w0 /path/to/firebase-service-account.json
```

## Firestore Collections

Enable Firestore for the same Firebase project. Agent Genaie writes central records to these collections:

- `users` — Firebase user profiles and service status
- `credentialRefs` — encrypted Gmail OAuth tokens and Webetu credentials
- `phoneLinksByUser` — active WhatsApp-to-user links keyed by Firebase UID
- `phoneLinksByPhone` — active WhatsApp-to-user links keyed by phone hash
- `accountLinkInvites` — short-lived account link setup tokens
- `jobScoutInvites` — short-lived Job Scout setup tokens
- `jobScoutProfiles` — Job Scout preferences and CV references
- `jobScoutDeliveryByPhone` — Job Scout delivery records keyed by phone hash
- `jobApplications` — recorded Job Scout application outcomes
- `webetuDeliveryByPhone` — Webetu delivery records keyed by phone hash
- `webetuPreferences` — per-user default restaurant and date overrides
- `webetuOverrides` — per-user single-day restaurant override records
- `webetuRestaurants` — restaurant catalog
- `webetuCatalogMeta` — catalog bootstrap status

Gmail OAuth tokens are stored in the local encrypted token store for the live send path and mirrored into Firestore as encrypted `credentialRefs` records. Webetu credentials saved through the dashboard are stored only as encrypted `credentialRefs` records. Firestore encrypted blobs use `CENTRAL_DATA_ENCRYPTION_SECRET`, which must be treated as a production secret and kept stable.

## Environment

Copy `.env.example` to `.env` and fill in the local values. Never commit `.env`.

```bash
export PUBLIC_BASE_URL="https://your-agent-genaie-domain.example"
export GOOGLE_CLIENT_ID="..."
export GOOGLE_CLIENT_SECRET="..."
export GOOGLE_REDIRECT_URI="https://your-agent-genaie-domain.example/auth/google/callback"
export TOKEN_ENCRYPTION_SECRET="$(openssl rand -base64 32)"
export OAUTH_STATE_SECRET="$(openssl rand -base64 32)"
export JOB_SCOUT_SETUP_SECRET="$(openssl rand -base64 32)"
export ACCOUNT_LINK_SETUP_SECRET="$(openssl rand -base64 32)"
export CENTRAL_DATA_ENCRYPTION_SECRET="$(openssl rand -base64 32)"
export CENTRAL_DATA_KEY_VERSION="v1"
export FIREBASE_PROJECT_ID="..."
export FIREBASE_API_KEY="..."
export FIREBASE_AUTH_DOMAIN="your-project.firebaseapp.com"
export FIREBASE_APP_ID="..."
export FIREBASE_EMAIL_LINK_URL="https://your-agent-genaie-domain.example/auth/firebase/finish"
export FIREBASE_SERVICE_ACCOUNT_JSON_BASE64="..."
export OWNER_FIREBASE_UID="..."
export AGENT_GENAI_INTERNAL_API_KEY="$(openssl rand -base64 32)"
export HOST=127.0.0.1
export PORT=3010
```

Set **all** secrets to distinct random values. If any are omitted they fall back to `TOKEN_ENCRYPTION_SECRET`, which means one leaked secret compromises everything at once.

`TOKEN_ENCRYPTION_SECRET` and `CENTRAL_DATA_ENCRYPTION_SECRET` encrypt data at rest. If production previously ran with only `TOKEN_ENCRYPTION_SECRET` set, pin `CENTRAL_DATA_ENCRYPTION_SECRET` to that same value — changing it makes existing Firestore credential blobs undecryptable without a migration.

`OAUTH_STATE_SECRET` signs short-lived (10-minute) OAuth state parameters. Changing it only breaks in-flight OAuth flows.

`JOB_SCOUT_SETUP_SECRET` and `ACCOUNT_LINK_SETUP_SECRET` sign setup invite tokens (24-hour TTL). Changing them invalidates pending invites; the agent can issue fresh links.

`OWNER_FIREBASE_UID` must be the Firebase UID of the fallback owner account whose Gmail is connected at `/{publicUserId}/connect-gmail`.

After login the app sets an HttpOnly `agent_genaie_session` cookie that protects app pages server-side. Google Sign-In is only for app login; Gmail sending requires the separate `/{publicUserId}/connect-gmail` authorization.

## Run

```bash
npm install
npm run typecheck
npm run dev       # development server with hot reload
npm start         # production (run `npm run build` first)
```

The public tunnel or reverse proxy should forward to `127.0.0.1:3010`.

## Firestore Backfill

After enabling Firestore and setting the environment, sync existing users and Gmail connections:

```bash
curl -X POST http://127.0.0.1:3010/internal/central-data/backfill \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $AGENT_GENAI_INTERNAL_API_KEY" \
  -d '{}'
```

Check the central database connection:

```bash
curl http://127.0.0.1:3010/internal/central-data/status \
  -H "authorization: Bearer $AGENT_GENAI_INTERNAL_API_KEY"
```

## Send Examples

Send as the signed-in Firebase user:

```bash
curl -X POST http://127.0.0.1:3010/gmail/send \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $FIREBASE_ID_TOKEN" \
  -d '{
    "to": "person@example.com",
    "subject": "Hello",
    "text": "This was sent through Gmail API.",
    "confirm": true
  }'
```

Internal send as a specific registered user (use `senderUid`), or as the owner fallback (`useOwnerAuth: true`):

```bash
curl -X POST http://127.0.0.1:3010/internal/gmail/send \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $AGENT_GENAI_INTERNAL_API_KEY" \
  -d '{
    "senderUid": "firebase-uid-of-sender",
    "to": "person@example.com",
    "subject": "Hello",
    "text": "This was sent through the selected Gmail connection.",
    "attachments": [
      {
        "filename": "example.txt",
        "contentType": "text/plain",
        "contentBase64": "SGVsbG8="
      }
    ],
    "confirm": true
  }'
```

Omit `senderUid` and pass `"useOwnerAuth": true` to fall back to the owner account.

## Public Repository Checklist

Before publishing this repository:

- Keep `.env`, `data/`, `logs/`, `archives/`, and `node_modules/` uncommitted.
- Do not commit Firebase service account JSON files, token stores, private keys, or generated archives.
- Rotate any secret that was ever committed before publication.
- Review screenshots under `assets/` for real domains, account names, resource names, or private operational details.
