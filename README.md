# Agent Genaie

Agent Genaie is a Node service for user onboarding, Firebase-backed login, Gmail OAuth connection, and internal service calls that send email through connected Gmail accounts.

## Routes

Public routes:

- `/login` starts Firebase passwordless email-link sign-in.
- `/auth/firebase/finish` completes Firebase email-link sign-in and creates the server session cookie.
- `/auth/session` creates or checks the Firebase-backed server session.
- `/auth/session/logout` clears the server session cookie.
- `/config/firebase` exposes the non-secret Firebase browser config.
- `/auth/google/callback` receives the Google OAuth callback.
- `/onboarding` shows the public Webetu onboarding guide.
- `/privacy-policy` explains Webetu credential and Gmail permission usage.
- `/health` checks service health.

Protected routes require the `agent_genaie_session` cookie or a Firebase bearer token:

- `/{publicUserId}` signed-in dashboard launcher with service tabs.
- `/{publicUserId}/vault` signed-in Webetu credential vault.
- `/{publicUserId}/onboarding` scoped compatibility route for the Webetu onboarding guide.
- `/{publicUserId}/connect-gmail` authenticated Gmail connect/disconnect page.
- `/`, `/connect-gmail`, and `/vault` redirect signed-in users to their scoped `/{publicUserId}` route.
- `POST /auth/google/start` starts Gmail OAuth for the signed-in Firebase user.
- `/auth/google/status` checks Gmail connection for the signed-in Firebase user.
- `/auth/google/revoke` revokes and removes stored Gmail tokens for the signed-in Firebase user.
- `GET /webetu/credentials/status` checks whether the signed-in user has saved Webetu credentials.
- `POST /webetu/credentials` encrypts and saves the signed-in user's Webetu username/password.
- `POST /webetu/credentials/revoke` revokes the signed-in user's stored Webetu credentials.
- `GET /internal/webetu/restaurants` lists supported Webetu restaurant names.
- `GET /internal/webetu/preferences?phone=...` reads a linked user's Webetu restaurant preference.
- `POST /internal/webetu/preferences/default` saves a confirmed default restaurant for a linked WhatsApp phone.
- `POST /internal/webetu/preferences/override` saves a confirmed one-day restaurant override.
- `/gmail/send` sends Gmail for the signed-in Firebase user only when `confirm` is `true`.

Internal routes require `Authorization: Bearer $AGENT_GENAI_INTERNAL_API_KEY`:

- `POST /internal/gmail/send` sends through the configured owner Gmail connection by default, or through a Gmail-connected registered user when `fromEmail` is provided.
- `GET /internal/gmail/senders` lists registered users who have connected Gmail, without returning token data.
- `POST /internal/job-scout/invite` creates a short-lived WhatsApp-to-login setup link.
- `POST /internal/job-scout/profile` saves WhatsApp-collected Job Scout preferences and a CV file reference.
- `GET /internal/job-scout/subscribers` lists Job Scout subscribers who are ready for application dispatch.
- `GET /internal/job-scout/applications` lists recorded Job Scout applications for one user.
- `POST /internal/job-scout/applications` records an applied, skipped, physical-submission, or failed Job Scout outcome.
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
2. Add your app domain as an authorized domain.
3. Create a web app and copy its `apiKey`, `authDomain`, `projectId`, and `appId`.
4. Create a service account key JSON file from Project settings -> Service accounts.
5. Base64 encode the service account JSON:

```bash
base64 -w0 /path/to/firebase-service-account.json
```

## Firestore Central Data

Enable Firestore for the same Firebase project. Agent Genaie writes central records to these collections:

- `users`
- `publicUsers`
- `serviceSubscriptions`
- `credentialRefs`
- `gmailConnections`
- `phoneLinks`
- `webetuUsers`
- `webetuRestaurantCatalog`
- `webetuRestaurantOverrides`

Gmail OAuth tokens remain in the local encrypted token store for the live send path and are mirrored into Firestore as encrypted `credentialRefs` records. Webetu credentials saved through the dashboard are stored only as encrypted `credentialRefs` records. Firestore encrypted blobs use `CENTRAL_DATA_ENCRYPTION_SECRET`, which must be treated as a production secret and kept stable.

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
export CENTRAL_DATA_ENCRYPTION_SECRET="$(openssl rand -base64 32)"
export CENTRAL_DATA_KEY_VERSION="v1"
export PASSBOLT_PUBLIC_URL="https://your-passbolt-domain.example"
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

`TOKEN_ENCRYPTION_SECRET` must stay stable. If it changes, existing stored token records cannot be decrypted.
`CENTRAL_DATA_ENCRYPTION_SECRET` must also stay stable. If it changes, encrypted Firestore credential blobs cannot be decrypted without migration.
`JOB_SCOUT_SETUP_SECRET` signs short-lived Job Scout setup links. If it is omitted, the app falls back to `OAUTH_STATE_SECRET`, then `TOKEN_ENCRYPTION_SECRET`.
`OWNER_FIREBASE_UID` must be the Firebase UID of the fallback owner account whose Gmail is connected at `/{publicUserId}/connect-gmail`.

After login, the app sets an HttpOnly `agent_genaie_session` cookie that protects app pages server-side.

## Run

```bash
npm install
npm run check
npm start
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

## Send Example

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

## Internal Send Example

```bash
curl -X POST http://127.0.0.1:3010/internal/gmail/send \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $AGENT_GENAI_INTERNAL_API_KEY" \
  -d '{
    "to": "person@example.com",
    "fromEmail": "sender@example.com",
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

Omit `fromEmail` to use the owner fallback.

## Public Repository Checklist

Before publishing this repository:

- Keep `.env`, `data/`, `logs/`, `archives/`, and `node_modules/` uncommitted.
- Do not commit Firebase service account JSON files, token stores, private keys, or generated archives.
- Rotate any secret that was ever committed before publication.
- Review screenshots under `assets/` for real domains, account names, resource names, or private operational details.
