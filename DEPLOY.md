# Deploying Rovin Bandana to Coolify

This app is a long-running Next.js 15 server (not serverless). It needs a
**Postgres** database and, optionally, **Supabase Storage** for admin image
uploads. It is deployed from this Git repo using the committed `Dockerfile`.

## One-time setup

### 1. Create the application in Coolify
- Coolify dashboard → your project → **+ New** → **Application**.
- Source: **Public** or **Private Repository (GitHub App / Deploy Key)** →
  point it at this repo, branch `main`.
- **Build Pack: `Dockerfile`.** Do not leave it on Nixpacks — the repo ships a
  multi-stage `Dockerfile` that builds `output: 'standalone'` and runs
  `node server.js`.
- Dockerfile location: `/Dockerfile` (the default).

### 2. Ports and domain
- **Port Exposes: `3000`** — the container listens on `3000` and binds
  `0.0.0.0` (both are set in the `Dockerfile`).
- Set your domain under **Domains**, e.g. `https://rovinbd.com`. Coolify
  terminates TLS and reverse-proxies to the container, so no port is needed
  in the URL.
- Point the domain's DNS `A` record at the Coolify server's IP before saving,
  so the certificate can be issued.
- Healthcheck: `/` is fine. It renders from the database, so a failing
  healthcheck usually means `POSTGRES_URL` is wrong rather than a bad build.

### 3. Database
Either use the existing Supabase Postgres, or run Postgres inside Coolify:

**Supabase** — dashboard → **Project Settings → Database → Connection string**.
Because this is a persistent server, the **direct connection (port 5432)** is
the better choice; the pooler is only needed for serverless.

**Postgres in Coolify** — project → **+ New → Database → PostgreSQL**. Use its
*internal* hostname in the connection string so traffic never leaves the host:
`postgres://postgres:<password>@<service-name>:5432/postgres`.

Tables and seed data are created automatically on first DB access
(`ensureSchema` in `src/lib/db.ts`).

### 4. Environment variables
Application → **Environment Variables**. Copy the full list from
[`.env.example`](.env.example), which documents every variable the code reads.
The minimum to boot:

| Name | Value |
|------|-------|
| `ADMIN_USERNAME` | your admin login |
| `ADMIN_PASSWORD` | a strong password |
| `AUTH_SECRET` | a long random string (32+ chars) |
| `POSTGRES_URL` | the connection string from step 3 |

Then the integrations you actually use: `NEXT_PUBLIC_GA_ID`,
`NEXT_PUBLIC_META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`, `GA4_API_SECRET`,
`ALPHA_SMS_API_KEY`, `PATHAO_*`, `TELEGRAM_*`,
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.

> **`NEXT_PUBLIC_*` variables are inlined at build time, not read at runtime.**
> In Coolify tick **Build Variable** on any you set (`NEXT_PUBLIC_GA_ID`,
> `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_META_PIXEL_ID`) and **redeploy**
> after changing one. A runtime-only value reaches the server but never
> reaches the browser bundle, so the tag stays dead with no error anywhere.

> **The Meta Pixel needs no env var.** The production pixel ID is hardcoded in
> `src/lib/pixel-config.ts`, the same way the GA ID is, because a missing
> variable previously disabled the pixel site-wide with no error anywhere. Set
> `NEXT_PUBLIC_META_PIXEL_ID` only to override it with a staging or test pixel.
> Verify what a running deploy uses with
> `curl https://<your-domain>/api/pixel/track`, which reports the active ID,
> whether it came from the env or the built-in default, and whether the CAPI
> token made it into the build.

### 5. Image uploads (persistence)
Admin uploads are **not** written to the container filesystem for production
use — a container rebuild would wipe them. The upload route
(`src/app/api/admin/upload/route.ts`) picks its target automatically:

- `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_KEY` set → **Supabase
  Storage**, bucket `images` (create it and make it public). Recommended.
- Either missing → falls back to storing bytes in Postgres
  (`uploaded_images` table), served from `/api/images/<id>`. This works and
  survives redeploys, but grows the database.

If you would rather keep uploads on the Coolify host, add a **Persistent
Storage** volume mounted at `/app/public/uploads` — but the Supabase Storage
path needs no volume at all.

### 6. Deploy
Click **Deploy**. Enable **Auto Deploy** (webhook on push to `main`) if you
want each push to redeploy.

## Local development

```bash
cp .env.example .env.local   # fill in POSTGRES_URL, ADMIN_*, AUTH_SECRET
npm install
npm run dev
```

To test the production image exactly as Coolify builds it:

```bash
docker build -t rovin --build-arg NEXT_PUBLIC_META_PIXEL_ID=<id> .
docker run --rm -p 3000:3000 --env-file .env.local rovin
```

## Notes
- The hero image (`/public/hero-banner.jpg`) and the CTA background
  (`/public/cta-background.jpg`) ship with the repo and are served by the app
  itself — no external asset host is involved.
- To reset the store, drop the tables in your Postgres client; they are
  recreated and reseeded on the next page load.
