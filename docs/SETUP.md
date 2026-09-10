# Cloud and provider setup

## Required for the board

Set `DATABASE_URL`, `APP_ORIGIN`, `OWNER_EMAIL` and at least one configured sign-in provider in server environment variables. Never use a `PUBLIC_` prefix or paste tokens into task text. The board does not accept a database password in a browser form. Its setup screen explains missing server configuration and allows rechecking.

Neon migration is additive: `conloca_board` retains the previous workspace document and `boards_records` stores identities, capabilities, pending confirmations, vectors and assets. The existing project is `crimson-hall-13043037`, database `scriptboard`; these identifiers are not credentials. No existing tasks or people are replaced by application initialization.

## Login (not the same as integration tokens)

| Provider | Server variables | Callback | Requested scope |
|---|---|---|---|
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `/api/auth/callback?provider=google` | `openid email profile` |
| GitHub OAuth app | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `/api/auth/callback?provider=github` | `read:user user:email` |
| Sign in with Slack | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, optional `SLACK_TEAM_ID` | `/api/auth/callback?provider=slack` | `openid email profile` |
| Email link | `RESEND_API_KEY`, `MAIL_FROM` | `/?verify=…` then explicit confirmation | Verified sender domain |

Prefix each callback with the exact HTTPS `APP_ORIGIN`. Slack OIDC form POST is supported, including its separate browser-binding cookie. Google/Slack ID tokens are verified against issuer JWKS; GitHub uses an authorization-code exchange and its authenticated profile and verified-email APIs. Google and GitHub requests use PKCE.

Admission is invite-only: `OWNER_EMAIL` and people already listed by email in the workspace. Matching a Google email to an existing GitHub identity **does not silently link the accounts**. Sign in using an existing identity first, then prove the new provider account from the profile. Sensitive linking requires a recent login. Other people can propose a provider link, but only its target can complete the authenticated flow.

Resend Free currently lists 3,000 emails/month and 100/day. The app caps email-link requests below this (80/day), but other applications sharing the same account also consume its allowance. Sign-in email is implemented; automatic invitation/reminder email campaigns are not. Confirmations are also visible in the in-app profile inbox.

## Slack and ticket integration

`SLACK_BOT_TOKEN` is separate from login. Grant `users:read` and `users:read.email`, then use the owner's **Import Slack people** action. Imported directory entries do not themselves grant provider identity ownership.

`GITHUB_TOKEN` is optional for public ticket previews, and required for private resources and comments. Restrict it to necessary repositories and issue/PR permissions. `LINEAR_API_KEY` is optional; without it, the UI reports Linear as disconnected. Configure a board's default GitHub repository to resolve `#123` and `PR #123`; `owner/repo#123` and full URLs do not require that default.

Only an explicit comment action posts a backlink. A durable pending/sent/uncertain record prevents automatic duplicate comments after a timeout. The comment links to an authenticated, highlighted board item, not a newly public share.

## AI drawings and embeddings

Recommended small-project cloud preset:

```
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
EMBEDDING_PROVIDER=cloudflare
IMAGE_DAILY_LIMIT=10
```

The token needs Workers AI access. Image model: `@cf/black-forest-labs/flux-1-schnell`, four steps. Multilingual embeddings: `@cf/baai/bge-m3`. Workers AI currently provides 10,000 Neurons/day at no charge; this is a compute allowance, not a fixed number of pictures. A paid Cloudflare plan may bill above its allowance. The app's image counter is an extra guard, not a guarantee against account-wide billing. No model license or paid plan is automatically accepted.

Without keys, the UI identifies local-library/keyword fallback honestly. A drawing can be reused by exact request hash or cosine similarity over stored title, description and keywords. Generated assets and vectors are stored server-side. Cosmetic header changes do not invoke an LLM for social previews.

### Local semantic model on Apple Silicon

```
cd tools/embeddings
uv run server.py
```

First launch downloads `intfloat/multilingual-e5-base`; it is based on XLM-RoBERTa and uses 768-dimensional vectors. The model uses MPS where available. Configure the board server:

```
EMBEDDING_PROVIDER=http
EMBEDDING_URL=http://127.0.0.1:8765
EMBEDDING_MODEL=intfloat/multilingual-e5-base
```

The default sidecar binds only to loopback. A Vercel function cannot reach your Mac's loopback. For hosted deployment use Cloudflare or an authenticated reachable embedding service; do not expose the local server without a secure transport and `EMBEDDING_API_KEY`.

Alternatively configure `EMBEDDING_PROVIDER=ollama`, `EMBEDDING_URL`, `EMBEDDING_MODEL=mxbai-embed-large`. The adapter calls `/api/embed`. Provider/model/mode is part of the vector cache key; incompatible dimensions are rejected. The default duplicate threshold 0.88 is a starting point, not a universal probability; calibrate on your team's examples.

## Photo import

Set `VISION_BASE_URL` (including `/v1/` when applicable), `VISION_API_KEY`, `VISION_MODEL` for an OpenAI-compatible image-capable chat endpoint. The browser resizes the photo before sending. The API returns only a draft; a separate authenticated import action creates the board after review. The photo is not retained in the workspace by default. Provider data-retention and model-license terms still apply.

## Sources (checked 2026-09-10)

- https://vercel.com/docs/cli/env
- https://neon.com/docs/reference/cli-connection-string
- https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- https://developers.google.com/identity/openid-connect/openid-connect
- https://docs.slack.dev/authentication/sign-in-with-slack/
- https://resend.com/pricing/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/
- https://huggingface.co/intfloat/multilingual-e5-base
- https://docs.ollama.com/api/embed
