# VAT — web deployment runbook

Commands below use shell variables. Real values live in the git-ignored `deploy/local.env`
(`source deploy/local.env` first); `SERVER` is the SSH target of the Ubuntu host.

```
browser ──▶ Cloudflare ──▶ Netlify  vat.stanleyowen.com   "/" = public landing page ("Sign in with Cloudflare")
            (Access on /app and /api: email one-time PIN)
                                                         │  static SPA (web/)
                                                         └─ edge fn /api/* ──(service token)──▶ Cloudflare Access
                                                                                                 vat-api.stanleyowen.com
                                                                                                        │ Cloudflare Tunnel
                                                                Ubuntu home server  ~/server/output-vat
                                                                docker compose: api (no host ports) + cloudflared
```

| Piece | Where |
|---|---|
| Netlify site | `$NETLIFY_SITE`, builds from `web/` on every push to `main` (GitHub-linked) |
| Netlify env | `API_ORIGIN`, `ALLOWED_HOST`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_WEB_AUD` (edge verifies the user's Access JWT), `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` (secret, production), optional `EDGE_SHARED_SECRET` (secret) |
| Transform Rule (optional) | Request header rule on `vat.stanleyowen.com` setting `x-ovat-edge: <EDGE_SHARED_SECRET>` — proves to the edge function that a request came through Cloudflare |
| Cloudflare Access apps | `VAT` (destinations `vat.stanleyowen.com/app` + `/api`, policy *Output VAT users*), `VAT API` (policy *Output VAT proxy token*). The root `/` and static assets are public (landing page, no data) |
| Sign-in | Cloudflare Access only — no app passwords. The API identifies users by the verified Access email and also requires it to be in `ALLOWED_EMAILS` |
| Service token | `output-vat-netlify-proxy` (expires after 1 year — see Rotation) |
| Tunnel | `output-vat-api` → `vat-api.stanleyowen.com`, token in server `.env` |
| Server | `~/server/output-vat` — `.env` (0600) holds `DATA_ENCRYPTION_KEY`, Access AUDs, tunnel token; `data/` holds the SQLite DB and encrypted files |

## Everyday operations (on the server)

```bash
cd ~/server/output-vat
docker compose ps                     # health
docker compose logs -f api            # logs (cookies/JWTs are redacted)
CLI='docker compose exec api node dist/cli.js'
$CLI list-users                       # everyone who has signed in, and ALLOWED_EMAILS
$CLI import-template <file> [name] [--default]
```

## Deploying changes

Both halves deploy themselves from `main`:

- **Web:** Netlify is linked to the GitHub repo and builds `web/` on every push to `main`.
  Pull requests from forks need approval before they build, and the secrets are production-only.
- **API:** the server pulls. Cron runs `~/server/autodeploy/server-autodeploy.sh`
  (a copy of `deploy/server-autodeploy.sh`) once a day at 03:30 server time, after the 03:00 borg backup.
  The same job deploys every GitHub-backed Docker app on the server. They are listed in
  `~/server/autodeploy/apps.conf`; `deploy/autodeploy-apps.conf.example` documents the format.
  For each app whose deployable paths changed on its branch:
  1. If the app has a test command (output-vat: `npm test`), it builds the Dockerfile's `test` stage
     and runs it with no network. If the tests fail, the running version stays live.
  2. It keeps the current images as `:previous`, updates the code and runs `docker compose up -d --build`.
  3. It waits until every container in the project is healthy. If one isn't, it restores the old files,
     rebuilds them and records the commit as failed. A failed commit is retried only once a newer commit lands.

  One app failing never stops the others. `.env*` and `data/` are never touched.
  Third-party images (immich, nextcloud and their databases) are not auto-updated.

```bash
ssh $SERVER '~/server/autodeploy/server-autodeploy.sh --status'       # every app: deployed commit, last result, containers
ssh $SERVER 'tail -30 ~/server/autodeploy/autodeploy.log'              # full log of the nightly runs
ssh $SERVER 'cat ~/server/autodeploy/history.log'                      # only real events: updates and failures
ssh $SERVER '~/server/autodeploy/server-autodeploy.sh output-vat'      # deploy one app now instead of waiting for 03:30
```

The cron copy of the script refreshes itself whenever a deployed `main` commit changes
`deploy/server-autodeploy.sh`. A commit merged to any of these apps' default branches runs on the server
within a day, so keep every one of those branches protected.

Manual fallback (e.g. to test a branch on the server):

```bash
rsync -az --delete --exclude node_modules --exclude dist --exclude data --exclude .env --exclude '.acc' \
  server/ $SERVER:server/output-vat/
ssh $SERVER 'cd ~/server/output-vat && chmod 700 . && docker compose up -d --build'
```

Before deploying engine changes, run the parity suite (must stay all-PASS for every desktop-app output):

```bash
cd server && PARITY_DATA_DIR=../../output-vat-db npm run parity
```

## Access list (who can sign in)

Two places, both must list the email (defence in depth):

1. Cloudflare Access policy — re-run the script with the full list (idempotent; needs a Cloudflare
   API token with Access + DNS + Transform Rules edit):

```bash
SSL_CERT_FILE=/etc/ssl/cert.pem python3 deploy/cloudflare_access.py --token-file ~/.ovat-cf-token \
  --zone $ZONE --web $WEB_HOST --api $API_HOST \
  --emails $ALLOWED,second@example.com --secret-out ~/.ovat-service-token.json \
  --netlify-target $NETLIFY_SITE.netlify.app --proxied --edge-secret-file ~/.ovat-edge-secret
```

2. Server allow-list:
```bash
ssh $SERVER "cd ~/server/output-vat && sed -i 's|^ALLOWED_EMAILS=.*|ALLOWED_EMAILS=$ALLOWED,second@example.com|' .env && docker compose up -d"
```
To remove someone, drop them from both lists. Signing out: the app's "Sign out" calls `/cdn-cgi/access/logout`.

## Edge shared secret (defence in depth)

The edge function always verifies the user's Access JWT before attaching the service token. Once
`EDGE_SHARED_SECRET` is set in Netlify it additionally requires the `x-ovat-edge` header, which only
Cloudflare adds — so requests sent straight to Netlify are refused before any JWT work. **Create the
Cloudflare rule first, then set the Netlify variable** (the other order locks everyone out):

1. Cloudflare dashboard → stanleyowen.com → Rules → Transform Rules → *Modify Request Header* → Create:
   filter `Hostname equals vat.stanleyowen.com`, *Set static* header `x-ovat-edge` = the secret.
   (Or: `deploy/cloudflare_access.py … --edge-secret-file ~/.ovat-edge-secret` with a token that has
   Zone › Transform Rules › Edit.)
2. `npx netlify-cli env:set EDGE_SHARED_SECRET "$(cat ~/.ovat-edge-secret)" --secret --context production`
   then `npx netlify-cli deploy --prod --build` from `web/`.

## Backups — important

Stored files are AES-256-GCM encrypted with `DATA_ENCRYPTION_KEY`. **Back up `data/` and the `.env` key separately**; without the key the files cannot be decrypted.

```bash
ssh $SERVER 'cd ~/server/output-vat && tar czf - data' > output-vat-data-$(date +%F).tgz
```

## Rotation

- **Service token** (yearly, or if leaked): delete `output-vat-netlify-proxy` in Zero Trust → Access → Service Auth, re-run `cloudflare_access.py` (writes new creds to `--secret-out`), then
  `npx netlify-cli env:set CF_ACCESS_CLIENT_ID …` / `env:set CF_ACCESS_CLIENT_SECRET … --secret --context production` and redeploy.
- **Tunnel token**: `cloudflared tunnel token output-vat-api`, update `TUNNEL_TOKEN` in the server `.env`, `docker compose up -d`.
- **Encryption key**: not rotatable in place (would need re-encrypting `data/files`).

## Branch protection

`main` is protected:
- Every change goes through a pull request, for admins too. No approval is needed.
- Force-pushes and deleting the branch are blocked.
