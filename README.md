# Rovin Bandana

E-commerce site + admin panel for a bandana business. Built with Next.js 15, React 19, Tailwind and Postgres. Self-hosted with Docker on Coolify — see [DEPLOY.md](DEPLOY.md).

## Quick start

```bash
npm install
npm run dev
```

Open the storefront at the URL the dev server prints (e.g. http://localhost:3000 or 3001).

## Admin panel

- URL: `/admin`
- Default username: `admin`
- Default password: `admin123`

Change credentials in `.env.local`:

```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
AUTH_SECRET=replace-this-with-a-long-random-string
```

## What you can do

**Storefront (public)**
- Browse and view bandanas
- Add to cart (stored in browser localStorage)
- Checkout with shipping address — no online payment, customer picks Cash on Delivery or Bank Transfer
- See order confirmation with order ID

**Admin panel**
- Dashboard with revenue, order counts, recent orders
- Products: add / edit / delete, upload images, mark as featured
- Orders: view all orders, see line items, update status (pending → confirmed → shipped → delivered → cancelled)
- Customers: list with order count & total spent, drill into customer history
- Banners: hero banners for the homepage, with image, title, CTA, active toggle, order
- Site Content: site name, tagline, about page text, contact info, shipping fee + free-shipping threshold

## Data storage

All data lives in **Postgres** — products, orders, customers, banners, site content. Set `POSTGRES_URL` (see `.env.example`); the tables and seed data are created automatically on first access by `ensureSchema` in `src/lib/db.ts`.

Admin image uploads go to Supabase Storage when `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set, and otherwise fall back to a Postgres table served from `/api/images/<id>`. Either way they survive a redeploy, so no host volume is required.

To reset the store, drop the tables in your Postgres client — they are recreated and reseeded on the next page load.

## Deployment

Deployed from this repo to **Coolify** using the committed `Dockerfile` (`output: 'standalone'`, listening on port 3000). Full setup — build pack, ports, database, environment variables, image storage — is in [DEPLOY.md](DEPLOY.md).

## File layout

```
src/
  app/
    page.tsx                 Home
    shop/                    Product listing
    product/[slug]/          Product detail
    cart/                    Cart
    checkout/                Checkout
    order-confirmation/[id]/ Success page
    about/, contact/         Static content pages
    admin/                   Admin panel (protected by middleware)
    api/                     Server routes
  components/                Shared UI
  lib/
    db.ts                    Postgres-backed data layer
    auth.ts                  JWT session helpers
    format.ts                Price + date helpers
  middleware.ts              Protects /admin
Dockerfile                   Production image built by Coolify
public/uploads/              Legacy local upload dir (uploads now go to Supabase Storage / Postgres)
```
