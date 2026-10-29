# MzansiDrive

Two-sided driving lesson marketplace for South Africa, for learners and verified instructors.

- Web: Next.js 15 + React 19 in apps/web
- Mobile: Expo / React Native iOS and Android in apps/mobile
- REST API: Express + TypeScript in apps/api
- Currency and time zone: ZAR and Africa/Johannesburg
- Production domain: www.mzansidrive.co.za
- Default instructor commission: 15%; a per-instructor value belongs on the instructor profile and can be changed only by an authorized admin.

## Run the web preview

Install Node.js 20 or newer, then from the repository root run npm install and npm run dev.
Open http://localhost:3000. The public learner marketplace uses demonstration instructor listings. Sign-in, learner profile completion, instructor onboarding, and role-specific routes are connected to Cognito and the API. Booking does not charge a card yet.

For the mobile app, set EXPO_PUBLIC_API_URL in apps/mobile/.env to a backend host reachable by your device, then run npm run start --workspace @mzansidrive/mobile.

For the API, copy apps/api/.env.example to apps/api/.env, set AWS credentials/configuration, Paystack settings, and `SES_FROM_EMAIL`, then run npm run dev --workspace @mzansidrive/api. Cognito signup, verification, role checks, learner profile completion, private uploads, instructor onboarding, instructor lookup, booking checkout, Paystack webhook handling, conditional payouts/refunds, memberships, and the admin payments workflow are wired. Learner/instructor dashboard aggregates, messaging, notifications, and other operational admin views still need implementation before production.

To create or reconcile the tables in the selected AWS region, run python infra/dynamodb/create_tables.py. The default region is af-south-1 and the default prefix is mzansidrive-. Existing tables are not overwritten.

## Authentication and onboarding

The Cognito user pool in af-south-1 uses email as the login identifier, sends a code for email verification, requires a 12-character password with mixed case, a number, and a symbol, and has a public no-secret app client for server-mediated web and mobile auth. Pool and app-client identifiers are in the API and web environment examples. Provision or reuse the pool and its learner, instructor, and admin groups with python infra/cognito/provision_pool.py.

Signup accepts learner or instructor only. Cognito's verified group membership is the authority for app roles; the mutable signup role attribute is not trusted for authorization. The admin group starts empty. Once an account has been created and email-verified, grant admin access explicitly:

aws cognito-idp admin-add-user-to-group --region af-south-1 --user-pool-id af-south-1_cEvUryZge --username <verified-admin-email> --group-name admin

The web app stores access, ID, and refresh tokens in HttpOnly, Secure-in-production, SameSite cookies. Its API proxy refreshes access and ID tokens through Cognito after expiry. The React Native app stores the same token set with Expo SecureStore and refreshes against the API. Set EXPO_PUBLIC_API_URL in apps/mobile/.env to an API host reachable from the phone or emulator.

Learner email verification is required before login. A learner who signs in without a completed profile is redirected to /complete-profile; the API also blocks learner dashboard and booking operations until required profile fields and both private S3 document uploads are complete. Instructor signup goes to a saved nine-step wizard covering basic information, teaching style, service area, vehicle and lesson classes, pricing, seven AI-checked documents, a ten-question K53 assessment, review and terms acceptance, and a personalised welcome. Submission requires all documents, R1,000,000 professional liability cover, an 80% K53 score, and accepted Terms of Use. It creates the pending instructor profile, InstructorStats and onboarding Achievement records, stores an in-app notification, and sends the welcome email through SES. Configure `SES_FROM_EMAIL` to a verified SES sender and grant the API role `ses:SendEmail` access. Admin sign-in is at /admin, and admin dashboard routes require the Cognito admin group.

The API's AWS runtime identity needs Cognito permissions for signup confirmation, group assignment, auth refresh/revocation, DynamoDB access to these tables, and S3 presigned upload/read access. The locally provisioned bucket is private, blocks public access, and encrypts objects at rest. For deployment, use a least-privilege runtime role and configure any additional production/staging web origins in the bucket CORS policy.

## Paystack payments

Set `PAYSTACK_SECRET_KEY` in the API environment, a public callback URL in `PAYSTACK_CALLBACK_URL`, and the Paystack weekly/monthly plan codes in `PAYSTACK_PLAN_WEEKLY` and `PAYSTACK_PLAN_MONTHLY`. Configure Paystack to send webhooks to `https://www.mzansidrive.co.za/v1/payments/paystack/webhook`; signature checks use the Paystack secret key. Web and mobile clients start hosted Paystack checkout through the authenticated API and never receive the secret key. Recurring instructor memberships require weekly and monthly plans to be configured in the same Paystack account.

Lessons are charged upfront in ZAR. The API verifies payment server-side before confirming the booking. A learner's available referral credit is applied up to R100 at checkout. Instructor completion and learner confirmation are both required before the API initiates a transfer to the instructor or their associated company. Recipient bank details must include the Paystack bank code, account number, and account name. Admins can review transactions, export CSV, retry failed eligible lesson transfers, and submit manual payouts from `/admin/payments`.

Paystack Split API settlement happens when a transaction is paid, so it cannot hold an instructor's share until both parties confirm lesson completion. This implementation collects into the platform's Paystack balance and initiates a Paystack transfer after confirmation. Paystack balance is a delayed payout workflow, not a regulated escrow account. The platform must be eligible for ZAR transfers as a registered Paystack business and have sufficient balance to fund transfers/refunds. Test business account eligibility and payout setup before enabling live payments.

## Data and service boundaries

Use Cognito user-pool groups/custom claims for the learner, instructor, and admin roles. Signup should use Cognito's email verification code before enabling the account. The API must verify the JWT signature and issuer and derive role from verified claims; never accept a client-selected role.

DynamoDB does not enforce fixed columns. The requested fields are stored as item attributes; only primary and index keys need declarations. The creation script uses on-demand billing and ALL projections for these secondary indexes:

| Table | Primary key | Secondary lookup indexes |
|---|---|---|
| users | id | email |
| learners | user_id | referral_code |
| instructors | user_id | city + user_id, verification_status + user_id, referral_code |
| companies | id | registration_number |
| bookings | id | learner_id + date, instructor_id + date, company_id + date, status + date |
| payment-transactions | id | user_id + created_at |
| messages | id | booking_id + created_at, receiver_id + created_at |
| reviews | id | instructor_id + booking_id, learner_id + booking_id, booking_id |
| learner-reviews | id | learner_id + booking_id, instructor_id + booking_id |
| lesson-plans | id | learner_id + booking_id, instructor_id + booking_id, booking_id |
| student-progress | id | learner_id + id, instructor_id + id |
| k53-test-results | id | learner_id + created_at, learner_id + test_type |
| drive-logbook | id | learner_id + booking_id, instructor_id + booking_id, booking_id |
| disputes | id | booking_id, status + id |
| notifications | id | user_id + created_at |
| achievements | id | instructor_id + unlocked_at |
| instructor-stats | id | instructor_id |
| ad-campaigns | id | instructor_id + platform |
| payouts | id | instructor_id + created_at, status + created_at |
| referrals | id | referrer_id + id, referred_id |
| video-lessons | id | instructor_id + title, type + title |
| enatis-slots | id | test_centre + available_date, province + available_date, learner_id + available_date |

DynamoDB does not apply column defaults. Instructor creation code must set commission_rate to 15 unless an authorized admin explicitly chooses another rate. Each booking should snapshot the instructor's commission and monetary amounts at checkout time.

Store profile images and verification documents in private S3 objects, serving short-lived signed URLs only after an authorization check. Store a booking's price, instructor commission, and platform fee as immutable booking snapshots so later admin changes do not rewrite prior settlements.

Paystack is the source of truth for payment state: checkout is initialized server-side, webhook signatures and charge status are verified, and transfers start only after both lesson completion confirmations. Keep secrets in AWS Secrets Manager or deployment secrets, not in source or browser bundles.

## Modal AI endpoints

The Express API exposes authenticated POST routes at `/ai/bio`, `/ai/generate-lesson-plan`, `/ai/student-assessment`, `/ai/instructor-coach`, `/ai/k53-questions`, `/ai/k53-analysis`, `/ai/smart-recommendations`, `/ai/marketing-content`, `/ai/availability-optimizer`, `/ai/chatbot`, `/ai/document-verify`, `/ai/welcome-message`, and `/ai/pricing-suggestion`. Inputs and structured JSON outputs are checked against shared Zod contracts. The API applies learner/instructor role guards where appropriate; recommendation candidates come from active instructor records.

Deploy the Modal app with `pip install modal`, `modal setup`, then create a Modal secret named `mzansidrive-ai` containing `ANTHROPIC_API_KEY` and a long random `API_AUTH_TOKEN`. Run `modal deploy infra/modal/mzansidrive_ai.py`. Set `MODAL_AI_URL` in `apps/api/.env` to the deployed app base URL (ending in `.modal.run`) and `MODAL_AI_TOKEN` to the same token. The Modal app uses `claude-sonnet-4-6` by default; set `ANTHROPIC_MODEL` in the Modal secret to another Anthropic model if needed. The Modal URL is called by the API only and must not be exposed to clients.

For `/ai/document-verify`, clients send `{ "document_type": "identity", "s3_url": "private/<signed-in-user-id>/..." }`. The API checks ownership, reads the private object from the configured bucket (maximum 12 MB), and forwards the file content and the stored profile to Modal. The model endpoint does not retrieve arbitrary URLs; document results are verification triage and must not be treated as legal identity proof.

Learner routes: K53 questions, K53 analysis, smart recommendations, and document verification. Instructor routes: lesson plan generation, student assessment, coaching, marketing, availability optimization, pricing, and document verification. Welcome messages and chatbot require authentication. Profile completion is enforced on learner and instructor workflows that depend on a finished profile.

Modal hosts inference endpoints; the API should proxy requests, keep endpoint tokens private, apply rate limits and input/output validation, and avoid sending learner/instructor personal data unless necessary. Twilio handles transactional reminder delivery. SNS/FCM handles push fan-out. Persist delivery preferences and notification IDs so retries are idempotent.

## Booking flow

The marketplace loads verified instructors from the API and shows their South African service areas on a Leaflet/OpenStreetMap map. Booking checkout calls the Modal availability optimizer, validates a four-digit South African postal code, and takes payment through Paystack. Street autocomplete uses Photon search limited to South Africa; keep the OpenStreetMap attribution shown with address suggestions.

Instructors publish weekly hours at `/instructor/availability`. Booking creates one DynamoDB lock per 30-minute interval in `booking-locks`, in the same transaction as the booking, to prevent overlapping bookings under concurrent requests. Unpaid checkout locks expire after 15 minutes; Paystack confirmation extends the lock to the lesson end. Run `infra/dynamodb/create_tables.py` to create the lock table and enable its TTL.

After payment, both parties receive an SES email and the instructor must accept the request. The EventBridge reminder dispatcher is in `infra/reminders`; deploy its SAM template and set the same random value in Lambda `ReminderToken` and API `EVENTBRIDGE_REMINDER_TOKEN`. It processes due reminders every five minutes using SES and Twilio. Set `TWILIO_PHONE_NUMBER` (or configure your sender) and `SES_FROM_EMAIL`. Rescheduling updates the slot locks and reminder schedule transactionally. The payout path remains gated on instructor completion and learner confirmation.

## eNaTIS slot feed

The homepage radar collects alert leads through `POST /v1/enatis/alert-lead`, and learners save province and test-centre preferences from the eNaTIS Monitor tab. Availability itself arrives from partners (DLTC monitors, driving schools or a manual curation job) through `POST /v1/enatis/slots`, guarded by `ENATIS_INGEST_TOKEN` sent as an `x-enatis-token` header; while that variable is unset the route answers 503. The payload is `{ "slots": [{ "province", "test_centre", "available_date": "YYYY-MM-DD", "available_times": ["08:30"], "status": "available|booked|cancelled", "source" }] }`, up to 100 slots per request. Slot ids are derived from province, centre and date, so re-posting an observation updates the row instead of duplicating it.

Slots expire automatically: the API runs a sweep at startup and then every 15 minutes (override with `ENATIS_EXPIRY_INTERVAL_MINUTES`) that flips any `available` row whose `available_date` is past in South Africa to `expired`, and the ingest route stores a past-dated observation as `expired` instead of `available` so it never alerts. Since the learner dashboard and the `enatis_check` action both filter on `status === "available"`, expired rows simply disappear from both. `POST /v1/internal/enatis/expire` runs the same sweep on demand for EventBridge or an operator, authenticated with the `x-reminder-token` header matching `EVENTBRIDGE_REMINDER_TOKEN`.

Each slot whose current run starts as `available` is matched against saved preferences and unclaimed leads, and every match raises one idempotent in-app notification plus an email, capped at 500 alerts per request. SMS is sent only when `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_PHONE_NUMBER` are set. Centre names are compared case-insensitively with a trailing "DLTC" removed, so a saved preference of "Langlaagte DLTC" matches a feed that posts "Langlaagte".

## Domain

Configure DNS for www.mzansidrive.co.za to the chosen hosting edge, attach a TLS certificate, and set the deployment's public URL and WEB_ORIGIN. This repository does not change DNS or deploy to the live domain.
