# Deploying Rovin Bandana to Vercel

This app uses **Supabase Postgres** (database) and commits uploaded images
straight to this **GitHub repo** (`public/uploads/`), which Vercel auto-deploys
on push. The local JSON file storage has been removed.

## One-time setup

### 1. Push the code to GitHub (recommended)
```bash
git init
git add .
git commit -m "Bandana store"
# create an empty repo on github.com, then:
git remote add origin https://github.com/<you>/rovin-bandana.git
git branch -M main
git push -u origin main
```

### 2. Import into Vercel
- Go to https://vercel.com/new
- Import the GitHub repo (or run `vercel` from this folder to link without GitHub).

### 3. Create the Supabase database
- Go to https://supabase.com/dashboard → **New project**.
- Once it's provisioned, go to **Project Settings → Database → Connection string**
  and copy the **Connection pooling** URI (Transaction mode, port 6543) —
  this is the one to use for serverless/Vercel deployments.
- Add it to your Vercel project as the `POSTGRES_URL` env var (see step 5).

### 4. Connect the Git repo (for image uploads to auto-deploy)
- Project → **Settings → Git** → connect this same GitHub repo, if not already connected.
- Without this, the upload route can still commit files to GitHub, but nothing will redeploy to publish them.

### 5. Add the admin + GitHub env vars
Project → **Settings → Environment Variables**, add (for Production + Preview):
| Name | Value |
|------|-------|
| `ADMIN_USERNAME` | your admin login |
| `ADMIN_PASSWORD` | a strong password |
| `AUTH_SECRET` | a long random string (32+ chars) |
| `POSTGRES_URL` | the Supabase connection pooling URI from step 3 |
| `GITHUB_TOKEN` | a GitHub Personal Access Token with "Contents: Read and write" on this repo |
| `GITHUB_REPO` | `owner/repo`, e.g. `fardiiin99/rovinbd` |
| `GITHUB_BRANCH` | `main` |
| `NEXT_PUBLIC_GA_ID` | your GA4 measurement ID, e.g. `G-Y3XL9ENBXH` |
| `NEXT_PUBLIC_META_PIXEL_ID` | your numeric Meta Pixel ID from Events Manager |
| `META_CAPI_ACCESS_TOKEN` | Conversions API access token (optional, recommended) |

> **The Meta Pixel does nothing until `NEXT_PUBLIC_META_PIXEL_ID` is set.**
> With it missing, the pixel base code is not rendered at all and every event
> (PageView, ViewContent, AddToCart, InitiateCheckout, Purchase) silently
> no-ops. `NEXT_PUBLIC_*` vars are inlined at **build** time, so after adding
> it you must **redeploy** — saving the env var alone changes nothing.
> Verify a live deploy with `curl https://<your-domain>/api/pixel/track`,
> which reports whether the ID and CAPI token made it into the build.

### 6. Deploy
- Push to `main` (or click **Deploy**). First page load auto-creates the tables and seeds sample data.

## Local development against the cloud DB
Copy `.env.example` to `.env.local` and fill in `POSTGRES_URL` (Supabase connection
pooling URI), `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `AUTH_SECRET`, then:
```bash
npm run dev
```

## Notes
- The hero image at `/public/hero-banner.jpg` ships with the repo. New admin uploads are committed to `public/uploads/` in this GitHub repo via the API and return a `/uploads/...` path; the change goes live once Vercel's Git-triggered deploy finishes (~1-2 min).
- Tables + seed data are created automatically on first DB access (`ensureSchema` in `src/lib/db.ts`).
- To reset the store, drop the tables in the Supabase **Table Editor** (or via SQL Editor); they'll be recreated and reseeded on next load.
