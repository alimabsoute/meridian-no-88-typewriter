# Updates signup

## Current state — September 18, 2026

The shared, responsive signup rail appears at the top of the landing/studio,
Community and Writing Board pages. It is emitted with the HTML and does not wait
for the typewriter or Three.js. An accessible paper receipt and brief confetti
appear only after the server confirms a save; reduced motion suppresses confetti.

The frontend and server handler are implemented, with two explicit collector
formats: the original signed Apps Script receiver and an adapter for the existing
Pulse collector. `signed` remains the default; reusing Pulse requires
`OCTOBERLINE_UPDATES_WEBHOOK_FORMAT=pulse`.

**The local preview is connected to the live private collector, and one reserved
test-address row has been verified in Google Sheets.** The browser form showed
its thank-you dialog after the save. The private URL and `pulse` format are
stored locally in ignored `.env.local`, which the workspace preview server loads.

Production configuration and publication are separate: the Octoberline Vercel
dashboard now confirms both Production and Preview have the URL saved as a
Secret and `OCTOBERLINE_UPDATES_WEBHOOK_FORMAT=pulse` saved as Config. No
redeployment has occurred yet, so the production form remains unverified.
Unconfigured environments still return HTTP 503 and preserve the email for
retry. No welcome email was sent; an email delivery/unsubscribe service is not
implemented. No commit or deployment was performed at this checkpoint.

### Earlier September 18 provisioning attempt

The dedicated Apps Script receiver and empty import workbook were prepared, but
the new Octoberline spreadsheet and web-app deployment were not created. The
connector rejected folder creation because approval was disabled. That remains
the history of the separate signed collector; the later Pulse adapter permits
reuse of the existing collector without creating another sheet or script.

## Data flow

1. A visitor submits an email with consent version `updates-v1` and the page path.
2. The same-origin Vercel endpoint validates the request, normalizes the email
   and selects the explicitly configured upstream format.
3. It sends either the signed envelope or Pulse's three-field JSON contract to
   the private server-configured Apps Script `/exec` endpoint.
4. The upstream must return a successful HTTP response with JSON containing
   `ok: true`. HTML, redirects without that final JSON, missing confirmation and
   upstream errors never trigger the website's success receipt.

The public API only accepts POST with JSON, caps input at 2 KB, validates email,
consent and source, and rejects a filled honeypot. It uses a 10-second upstream
timeout; the client uses 15 seconds. It does not log email addresses or upstream
payloads. These checks do not replace an abuse-monitoring/rate-limit service.

The endpoint rejects an unknown format, a missing URL, or a target outside the
supported HTTPS `script.google.com/macros/s/.../exec` form. In signed mode a
missing or short secret also returns 503. Browser assets receive neither the
collector URL nor its secret; the frontend always posts to Octoberline's API.

## Reuse the existing Pulse collector

Set these **server-only** variables on the Octoberline Vercel project:

| Variable | Configuration |
| --- | --- |
| `OCTOBERLINE_UPDATES_WEBHOOK_FORMAT` | `pulse` |
| `OCTOBERLINE_UPDATES_WEBHOOK_URL` | The existing Pulse collector's private `/exec` URL, supplied privately by the user or copied from authorized `PULSE_SIGNUP_WEBAPP_URL` configuration. |

Do not place that URL in source, notes, browser assets or any `VITE_` variable.
The adapter does not automatically read `PULSE_SIGNUP_WEBAPP_URL`: Octoberline
must receive its own private `OCTOBERLINE_UPDATES_WEBHOOK_URL` configuration.
The user-supplied value is now set locally in ignored `.env.local`, along with
the explicit `pulse` format. The workspace-only preview server loads those
values. Separately, the Vercel dashboard verified the URL Secret and format
Config in both Production and Preview environments; a new deployment is still
needed to use those settings. Pulse mode does not require
`OCTOBERLINE_UPDATES_WEBHOOK_SECRET`; it does not silently downgrade the default
signed mode when a secret is absent.

The Pulse request is an ordinary JSON POST with exactly three fields:

```js
{
  email: normalizedEmail,
  source: 'Octoberline 211 /route',
  userAgent: 'Browser: ' + browserUserAgent
}
```

`/route` is the validated page path, including `/` for the homepage. The user
agent is capped at 240 input characters and prefixed with `Browser: `. Email
values beginning with a spreadsheet formula prefix are escaped before forwarding.
This mode sends no HMAC envelope; the existing collector must accept this exact
contract and confirm the saved row with `{ "ok": true }`. A single live append
has now been verified through the local form. Duplicate handling remains
unverified; the signed receiver's tested locking/deduplication guarantees must
not be assumed for Pulse.

Deploy the project root, including `api/`, after configuring the variables.
The local-to-live-Sheets connection and Vercel environment configuration are
verified. Production still requires redeployment and a production-form test
with sheet read-back before collection on the public site can be described as
working.

## Optional signed collector provisioning

Use this path when choosing the original `signed` format rather than the
existing Pulse receiver. The dedicated receiver verifies HMAC-SHA256 and a
five-minute timestamp window, locks the sheet, deduplicates email, appends the
row and flushes it before returning `{ "ok": true }`. Repeated email submission
is idempotent in this receiver.

Use the prepared `work/updates-signup/octoberline-211-updates-signups.xlsx`, or
create a private spreadsheet named **Octoberline 211 — Updates signups** with
one `Subscribers` tab and the exact header row below. No sample subscribers are
needed. Freeze the header and apply a filter after importing.

| Signed up (UTC) | Email | Source page | Consent | Status | Request ID |
| --- | --- | --- | --- | --- | --- |

Keep spreadsheet sharing restricted. In its Apps Script project, install
`integrations/google-sheets/Code.gs` and `appsscript.json`. Set these Script
Properties through the Google UI:

- `OCTOBERLINE_SHEET_ID`: the private spreadsheet ID.
- `OCTOBERLINE_WEBHOOK_SECRET`: a newly generated random secret of at least 32
  characters, shared only with the Vercel server configuration.

Deploy as a web app executing as the owner, with access allowing the server's
unauthenticated HTTP request. The handler itself requires the HMAC signature;
it offers no read/list endpoint. Review and authorize the requested spreadsheet
scope as the account owner. Google domain policies may restrict deployment.

Configure these **server-only** Vercel environment variables; never prefix them
with `VITE_` and never include their values in source, notes or browser assets:

- `OCTOBERLINE_UPDATES_WEBHOOK_URL`: the production Apps Script `/exec` URL.
- `OCTOBERLINE_UPDATES_WEBHOOK_SECRET`: the matching secret.
- `OCTOBERLINE_UPDATES_WEBHOOK_FORMAT`: `signed`, or omit it to use the default.

Redeploy the **project root**, including `api/`, after setting the variables.
Uploading only the prebuilt `dist/` folder omits the server function and will
leave collection unavailable. Follow the normal release checks before
publishing. Google Content Service follows a redirect, which the server permits.
The frontend never submits directly to Google or makes the sheet public.

References: [Apps Script web apps](https://developers.google.com/apps-script/guides/web),
[Content Service](https://developers.google.com/apps-script/guides/content),
[Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js).

## Validation and hosting limits

`npm run test:updates` exercises the server and Apps Script with local service
mocks, including signatures, request validation, failure responses, deduplication,
formula escaping and lock release. This is not a real Google append test.
`src/updates-signup.test.js` covers the browser request contract. Native evidence
also lives in `visual-checks/updates-signup-ui-native.json` when generated.

The current native signup report records 64 passing checks. The Pulse adapter's
10 local checks passed at `2026-09-18T15:31:46.738Z`; run
`node scripts/pulse-signup-adapter-check.mjs` to exercise its exact body format,
explicit success requirement, failure handling, formula protection and mode
selection. Its evidence is `visual-checks/pulse-signup-adapter-native.json`.
These checks use injected HTTP mocks and write nothing to a real collector.
Vite/Vitest remained blocked by `spawn EPERM`; the Vercel CLI also encountered
proxy `ECONNREFUSED`/process restrictions. Settings were saved and verified in
the dashboard instead. The GitHub API write was blocked because it required
approval while the approval policy was `never`; no new blob, commit, push or
deployment was created. No full build or production-browser pass is claimed by
this checkpoint. The verified Vercel settings await updated source publication.

### Verified local form to live Sheets — September 18, 2026

An actual browser submission from the local studio used a reserved `example.com`
test address. The form displayed its thank-you dialog. A Google connector search
then verified row 5 at `2026-09-18T16:13:21.391Z`, with Source
`Octoberline 211 /studio`. One test row is retained; no real subscriber records
were read during this verification. Neither the private collector URL nor the
test address is reproduced here.

This is a real local-server-to-live-Sheets append, separate from the mocked
native tests. The production and preview settings have since been verified in
the Vercel dashboard, but no new deployment exists yet. After redeployment,
repeat an authorized test submission,
sheet read-back and visual receipt check there. Duplicate behavior still needs
verification. Mobile-browser validation is not established: the attempted
viewport override did not change the browser viewport. Remove retained test
data only through normal recoverable operations when appropriate.

Vercel runs the API from `api/`. Static GitHub Pages, standalone HTML and the web
ZIP cannot run it. `file://` deliberately disables signup with an explanation.
Generic static hosting retains honest request failure behavior; use the canonical
Vercel site for working collection. Do not describe a static package as connected.
