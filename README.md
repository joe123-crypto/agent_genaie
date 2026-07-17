# Agent Genaie

Agent Genaie is the Genaie Scout web app: Job Scout is the product — an AI agent that searches and applies for jobs on a user's behalf and reports every application over WhatsApp. The Next.js app handles user onboarding, Firebase-backed login, Gmail OAuth connection, CV storage, and the internal service calls used by the agent workers.

## Hidden Legacy Service: Webetu Reservations

The product is Job Scout only. The Webetu meal-reservation service is hidden from every public-facing surface (landing page, onboarding, dashboard navigation and services) pending extraction into its own project. Its code remains functional: `/{publicUserId}/vault` still works by direct URL for existing users, and the `/webetu/*` and `/internal/webetu/*` routes and Webetu Firestore collections listed below stay live for the agent workers.

## Routes

Public routes:

- `/` is the public Genaie Scout landing page and links visitors to sign in at `/login`.
- `/login` supports Firebase Google Sign-In and passwordless email-link sign-in.
- `/auth/firebase/finish` completes Firebase email-link sign-in and creates the server session cookie.
- `/auth/session` creates or checks the Firebase-backed server session. `POST` also returns `publicUserId`, `isNewUser`, and `onboardingRequired`.
- `/auth/session/logout` clears the server session cookie.
- `/config/firebase` exposes the non-secret Firebase browser config.
- `/auth/google/callback` receives the Google OAuth callback.
- `/whatsapp?token=...` preserves a WhatsApp-originated invite through sign-in and redirects to the signed-in user's scoped WhatsApp page.
- `/privacy-policy` explains CV, Gmail permission, and WhatsApp usage.
- `/health` checks service health.

Protected routes require the `agent_genaie_session` cookie or a Firebase bearer token:

- `/{publicUserId}` signed-in dashboard launcher with service tabs.
- `/{publicUserId}/vault` signed-in Webetu credential vault (legacy; reachable by direct URL only, not linked in navigation).
- `/{publicUserId}/connect-gmail` authenticated Gmail connect/disconnect page.
- `/{publicUserId}/job-scout` signed-in Job Scout setup page for CV, target role, target location, and acknowledgements.
- `/{publicUserId}/onboarding` one-time signup onboarding controller; auto-selects Job Scout and forwards to the next required step.
- `/{publicUserId}/whatsapp` is the canonical WhatsApp linking page. Invite mode shows the originating masked number and confirmation; direct-web mode accepts a number and starts bot verification.
- `/connect-gmail` and `/vault` redirect signed-in users to their scoped `/{publicUserId}` route.
- `POST /auth/google/start` starts Gmail OAuth for the signed-in Firebase user.
- `GET /auth/google/status` checks Gmail connection for the signed-in Firebase user.
- `POST /auth/google/revoke` revokes and removes stored Gmail tokens for the signed-in Firebase user.
- `GET /account/status` returns the signed-in user's WhatsApp link and service status.
- `GET /account/onboarding/status` returns the signed-in user's onboarding selection, state, and next required step.
- `POST /account/onboarding/select` starts onboarding for `jobs` or `webetu` (the web flow auto-selects `jobs`; `webetu` is accepted for legacy compatibility).
- `POST /account/onboarding/skip` marks onboarding skipped.
- `POST /account/onboarding/complete` marks onboarding complete once the selected service requirements are satisfied.
- `POST /account/whatsapp/link-request` is the canonical linking handler: it confirms a WhatsApp-originated token or creates a direct-web phone verification request.
- `POST /account/whatsapp/revoke` revokes the signed-in user's active WhatsApp link.
- `GET /webetu/credentials/status` checks whether the signed-in user has saved Webetu credentials.
- `POST /webetu/credentials` encrypts and saves the signed-in user's Webetu username/password.
- `POST /webetu/credentials/revoke` revokes the signed-in user's stored Webetu credentials.
- `POST /gmail/send` sends Gmail for the signed-in Firebase user only when `confirm` is `true`.
- `GET /job-scout/profile/status` returns the signed-in user's Job Scout readiness.
- `POST /job-scout/profile` uploads or reuses the signed-in user's CV and saves a ready Job Scout profile.

Internal routes require `Authorization: Bearer $AGENT_GENAI_INTERNAL_API_KEY`:

- `POST /internal/gmail/send` sends through a specified Gmail connection. Pass `senderUid` to send as a registered user, `useOwnerAuth: true` to use the owner fallback, or `senderKey` directly.
- `GET /internal/gmail/senders` lists registered users who have connected Gmail, without returning token data.
- `POST /internal/account-link/invite` creates a short-lived WhatsApp-to-login account link setup URL.
- `GET /internal/account-link/status` checks the current account link status for a phone number.
- `POST /internal/onboarding/start` starts or resumes one service's web or chat onboarding route and creates the canonical link only when the phone is not linked.
- `POST /internal/job-scout/profile` saves WhatsApp-collected Job Scout preferences and a CV file reference.
- `GET /internal/job-scout/status?phone=...` returns one requester's Job Scout readiness and missing requirements.
- `POST /internal/job-scout/cv` uploads a user's CV PDF to R2 (multipart `file` + `userId` or `phone`); stored at `<uid>/cv/cv.pdf`.
- `GET /internal/job-scout/cv?userId=...` returns a short-lived presigned URL to download the user's CV.
- `DELETE /internal/job-scout/cv?userId=...` deletes the user's CV from R2 and clears the profile reference.
- `GET /internal/job-scout/subscribers` lists only Job Scout subscribers who pass the backend readiness checks.
- `GET /internal/job-scout/applications` lists recorded Job Scout applications for one user.
- `POST /internal/job-scout/applications` records an applied, skipped, physical-submission, or failed Job Scout outcome.
- `POST /internal/dashboard/tasks` upserts one live dashboard task status snapshot for a user. Pass `userId`, or pass `phone` to resolve the active linked user.
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
5. Create a web app and copy its `apiKey`, `projectId`, and `appId`.
6. Create a service account key JSON file from Project settings -> Service accounts.
7. Base64 encode the service account JSON:

```bash
base64 -w0 /path/to/firebase-service-account.json
```

For reliable mobile redirect sign-in on browsers that restrict third-party storage, set `FIREBASE_AUTH_DOMAIN` to the hostname serving Agent Genaie, not the default `firebaseapp.com` hostname. The Next.js configuration proxies `/__/auth/*` to `<FIREBASE_PROJECT_ID>.firebaseapp.com`. Add the following redirect URI to the Google OAuth client before deploying this setting:

```text
https://your-agent-genaie-domain.example/__/auth/handler
```

## Firestore Collections

Enable Firestore for the same Firebase project. Agent Genaie writes central records to these collections:

- `users` — Firebase user profiles and service status
- `credentialRefs` — encrypted Gmail OAuth tokens and Webetu credentials
- `phoneLinksByUser` — active WhatsApp-to-user links keyed by Firebase UID
- `phoneLinksByPhone` — active WhatsApp-to-user links keyed by phone hash
- `accountLinkInvites` — short-lived account link setup tokens
- `jobScoutProfiles` — Job Scout preferences and CV references; `cvFileRef` is the R2 object key `<uid>/cv/cv.pdf` (the CV itself lives in the R2 bucket, not Firestore)
- `jobScoutDeliveryByPhone` — Job Scout delivery records keyed by phone hash
- `jobApplications` — recorded Job Scout application outcomes
- `webetuDeliveryByPhone` — Webetu delivery records keyed by phone hash
- `dashboardTaskStatus` — live agent schedule/run snapshots keyed by `<uid>_<taskId>` for the signed-in dashboard
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
export FIREBASE_AUTH_DOMAIN="your-agent-genaie-domain.example"
export FIREBASE_APP_ID="..."
export FIREBASE_EMAIL_LINK_URL="https://your-agent-genaie-domain.example/auth/firebase/finish"
export FIREBASE_SERVICE_ACCOUNT_JSON_BASE64="..."
export OWNER_FIREBASE_UID="..."
export AGENT_GENAI_INTERNAL_API_KEY="$(openssl rand -base64 32)"
export WHATSAPP_BOT_PHONE="+213600000000"
export R2_ACCOUNT_ID="..."
export R2_ACCESS_KEY_ID="..."
export R2_SECRET_ACCESS_KEY="..."
export R2_BUCKET="..."
export HOST=127.0.0.1
export PORT=3010
```

`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET` configure the Cloudflare R2 (S3-compatible) bucket that stores user CVs. Objects are keyed by Firebase UID (`<uid>/cv/cv.pdf`). `R2_ENDPOINT` is optional and defaults to `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`. Run `npm run migrate:cvs -- --dry-run` to preview migrating existing on-disk CVs into R2, then without `--dry-run` to perform it.

Set **all** secrets to distinct random values. If any are omitted they fall back to `TOKEN_ENCRYPTION_SECRET`, which means one leaked secret compromises everything at once.

`TOKEN_ENCRYPTION_SECRET` and `CENTRAL_DATA_ENCRYPTION_SECRET` encrypt data at rest. If production previously ran with only `TOKEN_ENCRYPTION_SECRET` set, pin `CENTRAL_DATA_ENCRYPTION_SECRET` to that same value — changing it makes existing Firestore credential blobs undecryptable without a migration.

`OAUTH_STATE_SECRET` signs short-lived (10-minute) OAuth state parameters. Changing it only breaks in-flight OAuth flows.

`ACCOUNT_LINK_SETUP_SECRET` signs all setup invite tokens (24-hour TTL). `JOB_SCOUT_SETUP_SECRET` is accepted only as a configuration fallback for older deployments; there is no separate Job Scout invite route or collection in the active flow.

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

## Dashboard Telemetry

The signed-in dashboard renders setup readiness from existing account/service records and schedule/run telemetry from Firestore. It does not synthesize sample cron rows. Until the agent publishes telemetry, ready services show “No live schedule reported yet.”

Agent workers should publish each task through the internal route:

```bash
curl -X POST http://127.0.0.1:3010/internal/dashboard/tasks \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $AGENT_GENAI_INTERNAL_API_KEY" \
  -d '{
    "userId": "firebase-uid",
    "taskId": "reserve_meals",
    "service": "webetu",
    "enabled": true,
    "status": "active",
    "scheduleLabel": "Daily - 10:00 AM",
    "timezone": "Africa/Algiers",
    "nextRunAt": "2026-07-17T09:00:00.000Z",
    "lastRunAt": "2026-07-16T06:45:00.000Z",
    "lastRunStatus": "success",
    "lastRunSummary": "Meals reserved"
  }'
```

Accepted `taskId` and `service` pairs:

- `reserve_meals` with `webetu`
- `search_apply_jobs` with `job_scout`
- `deliver_results` with `delivery`

`status` must be `active`, `running`, `paused`, `failed`, or `disabled`. `lastRunStatus`, when present, must be `success`, `partial`, `failed`, `skipped`, or `action_required`.

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
