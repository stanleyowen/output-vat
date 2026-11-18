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
- **API:** the server pulls. Cron runs `~/server/output-vat-autodeploy.sh`
  (a copy of `deploy/server-autodeploy.sh`) once a day at 03:30 (server time). When `server/` changes on `main`:
  1. It builds the test image and runs the tests. If they fail, the running version stays live.
  2. It keeps the current image as `:previous`, then rebuilds and restarts.
  3. It waits for the healthcheck. If that fails, it rolls back automatically.

  `.env` and `data/` are never touched. Logs go to `~/server/output-vat-autodeploy.log`.

```bash
ssh $SERVER 'tail -20 ~/server/output-vat-autodeploy.log'      # what happened
ssh $SERVER 'cat ~/server/output-vat/.deployed-commit'         # running commit
ssh $SERVER '~/server/output-vat-autodeploy.sh'                # deploy now instead of waiting for 03:30
```

Manual fallback (e.g. to test a branch on the server):

```bash
rsync -az --delete --exclude node_modules --exclude dist --exclude data --exclude .env --exclude '.acc' \
  --exclude .deployed-commit --exclude .failed-commit server/ $SERVER:server/output-vat/
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
