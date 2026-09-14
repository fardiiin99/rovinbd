import { sql } from './pg';

export type ProductVariant = {
  id: string;
  name: string;
  image: string;
  stock: number;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  description: string;
  price: number;
  cost: number;
  stock: number;
  image: string;
  category: string;
  featured: boolean;
  variants: ProductVariant[];
  variantStyle?: 'image' | 'size';
  createdAt: number;
};

export type OrderItem = {
  productId: string;
  name: string;
  price: number;
  qty: number;
  image: string;
  variantId?: string;
  variantName?: string;
};

export type Order = {
  id: string;
  orderNumber: number;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: string;
  city: string;
  postalCode: string;
  notes: string;
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  total: number;
  status: 'pending' | 'dispatched' | 'received' | 'returned';
  paymentMethod: 'cod' | 'bank_transfer';
  deliveryZone: 'inside_dhaka' | 'outside_dhaka';
  pathaoConsignmentId?: string;
  pathaoDeliveryFee?: number;
  pathaoCollectedAmount?: number;
  createdAt: number;
};

// Delivery charges by zone (Bangladeshi Taka)
export const DELIVERY_CHARGES = {
  inside_dhaka: 80,
  outside_dhaka: 120,
} as const;
export type DeliveryZone = keyof typeof DELIVERY_CHARGES;

export type Customer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  orderCount: number;
  totalSpent: number;
  lastOrderAt: number;
  createdAt: number;
};

export type Banner = {
  id: string;
  title: string;
  subtitle: string;
  ctaText: string;
  ctaLink: string;
  image: string;
  active: boolean;
  order: number;
};

export type CategoryTile = {
  id: string;
  kind: 'feature' | 'product';
  label: string;
  sublabel: string;
  link: string;
  image: string;
  bgColor: string;
  order: number;
};

export type SiteContent = {
  siteName: string;
  tagline: string;
  aboutTitle: string;
  aboutBody: string;
  contactEmail: string;
  contactPhone: string;
  contactAddress: string;
  shippingFee: number;
  freeShippingOver: number;
  heroImage: string;
  heroHeadline: string;
  heroSubheadline: string;
  heroCtaText: string;
  heroCtaLink: string;
  returnFee: number;
};

// ---------- helpers ----------

function uid(prefix: string) {
  return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const READ_CACHE_TTL_MS = 30_000;
const readCache = new Map<string, { expiresAt: number; value: Promise<unknown> }>();

async function cachedRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  const cached = readCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as Promise<T>;
  const value = load();
  readCache.set(key, { expiresAt: Date.now() + READ_CACHE_TTL_MS, value });
  try {
    return await value;
  } catch (error) {
    readCache.delete(key);
    throw error;
  }
}

function invalidateStorefrontCache() {
  readCache.clear();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToProduct(r: any): Product {
  let variants: ProductVariant[] = [];
  if (r.variants) {
    try {
      const raw = typeof r.variants === 'string' ? JSON.parse(r.variants) : r.variants;
      if (Array.isArray(raw)) variants = raw as ProductVariant[];
    } catch { variants = []; }
  }
  return {
    id: r.id, slug: r.slug, name: r.name, description: r.description,
    price: Number(r.price), cost: Number(r.cost) || 0, stock: Number(r.stock), image: r.image,
    category: r.category, featured: !!r.featured, variants,
    variantStyle: (r.variant_style as 'image' | 'size') || 'image',
    createdAt: Number(r.created_at),
  };
}
function rowToCustomer(r: any): Customer {
  return {
    id: r.id, name: r.name, email: r.email, phone: r.phone, address: r.address,
    city: r.city, postalCode: r.postal_code, orderCount: Number(r.order_count),
    totalSpent: Number(r.total_spent),
    lastOrderAt: r.last_order_at ? Number(r.last_order_at) : Number(r.created_at),
    createdAt: Number(r.created_at),
  };
}
function rowToOrder(r: any): Order {
  return {
    id: r.id, orderNumber: Number(r.order_number) || 0, customerId: r.customer_id, customerName: r.customer_name,
    customerEmail: r.customer_email, customerPhone: r.customer_phone,
    shippingAddress: r.shipping_address, city: r.city, postalCode: r.postal_code,
    notes: r.notes, items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items,
    subtotal: Number(r.subtotal), shipping: Number(r.shipping), total: Number(r.total),
    status: r.status, paymentMethod: r.payment_method,
    deliveryZone: r.delivery_zone || 'inside_dhaka',
    pathaoConsignmentId: r.pathao_consignment_id || undefined,
    pathaoDeliveryFee: r.pathao_delivery_fee != null ? Number(r.pathao_delivery_fee) : undefined,
    pathaoCollectedAmount: r.pathao_collected_amount != null ? Number(r.pathao_collected_amount) : undefined,
    createdAt: Number(r.created_at),
  };
}
function rowToBanner(r: any): Banner {
  return {
    id: r.id, title: r.title, subtitle: r.subtitle, ctaText: r.cta_text,
    ctaLink: r.cta_link, image: r.image, active: !!r.active, order: Number(r.order),
  };
}
function rowToTile(r: any): CategoryTile {
  return {
    id: r.id, kind: r.kind, label: r.label, sublabel: r.sublabel, link: r.link,
    image: r.image, bgColor: r.bg_color, order: Number(r.order),
  };
}
function rowToContent(r: any): SiteContent {
  return {
    siteName: r.site_name, tagline: r.tagline, aboutTitle: r.about_title, aboutBody: r.about_body,
    contactEmail: r.contact_email, contactPhone: r.contact_phone, contactAddress: r.contact_address,
    shippingFee: Number(r.shipping_fee), freeShippingOver: Number(r.free_shipping_over),
    heroImage: r.hero_image, heroHeadline: r.hero_headline, heroSubheadline: r.hero_subheadline,
    heroCtaText: r.hero_cta_text, heroCtaLink: r.hero_cta_link,
    returnFee: r.return_fee != null ? Number(r.return_fee) : 100,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------- schema + seed (memoized) ----------

let readyPromise: Promise<void> | null = null;

function ready(): Promise<void> {
  if (!readyPromise) readyPromise = ensureSchema();
  return readyPromise;
}

async function ensureSchema() {
  await sql`CREATE TABLE IF NOT EXISTS products (
    id text PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL, description text DEFAULT '',
    price numeric NOT NULL DEFAULT 0, stock integer NOT NULL DEFAULT 0, image text DEFAULT '/placeholder.svg',
    category text DEFAULT '', featured boolean DEFAULT false, created_at bigint NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS customers (
    id text PRIMARY KEY, name text, email text, phone text, address text, city text, postal_code text,
    order_count integer DEFAULT 0, total_spent numeric DEFAULT 0, created_at bigint NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS orders (
    id text PRIMARY KEY, customer_id text, customer_name text, customer_email text, customer_phone text,
    shipping_address text, city text, postal_code text, notes text, items jsonb NOT NULL DEFAULT '[]',
    subtotal numeric DEFAULT 0, shipping numeric DEFAULT 0, total numeric DEFAULT 0,
    status text DEFAULT 'pending', payment_method text DEFAULT 'cod',
    delivery_zone text DEFAULT 'inside_dhaka', created_at bigint NOT NULL
  )`;
  // migrations for existing databases
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_zone text DEFAULT 'inside_dhaka'`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number integer`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS variants jsonb DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_style text DEFAULT 'image'`;
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_order_at bigint`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pathao_consignment_id text`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pathao_delivery_fee numeric`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pathao_collected_amount numeric`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS cost numeric DEFAULT 0`;
  // Backfill: set last_order_at = created_at where null, then take max from orders if any newer
  await sql`UPDATE customers SET last_order_at = created_at WHERE last_order_at IS NULL`;
  await sql`UPDATE customers c SET last_order_at = sub.max_created
    FROM (SELECT customer_id, MAX(created_at) AS max_created FROM orders GROUP BY customer_id) sub
    WHERE c.id = sub.customer_id AND (c.last_order_at IS NULL OR c.last_order_at < sub.max_created)`;
  await sql`CREATE TABLE IF NOT EXISTS sms_history (
    id text PRIMARY KEY, customer_id text, phone text, message text,
    status text, error text, sent_at bigint NOT NULL
  )`;
  // create sequence starting at 1001 if it doesn't exist
  await sql`CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1001`;
  // backfill any rows that have no order_number yet
  await sql`UPDATE orders SET order_number = nextval('order_number_seq') WHERE order_number IS NULL`;
  await sql`CREATE TABLE IF NOT EXISTS banners (
    id text PRIMARY KEY, title text, subtitle text, cta_text text, cta_link text,
    image text, active boolean DEFAULT true, "order" integer DEFAULT 1
  )`;
  await sql`CREATE TABLE IF NOT EXISTS category_tiles (
    id text PRIMARY KEY, kind text, label text, sublabel text, link text,
    image text, bg_color text, "order" integer DEFAULT 1
  )`;
  await sql`CREATE TABLE IF NOT EXISTS site_content (
    id integer PRIMARY KEY DEFAULT 1,
    site_name text, tagline text, about_title text, about_body text,
    contact_email text, contact_phone text, contact_address text,
    shipping_fee numeric DEFAULT 0, free_shipping_over numeric DEFAULT 0,
    hero_image text, hero_headline text, hero_subheadline text, hero_cta_text text, hero_cta_link text
  )`;
  await sql`ALTER TABLE site_content ADD COLUMN IF NOT EXISTS return_fee numeric DEFAULT 100`;
  await seedIfEmpty();
  await migrateStorefrontCatalog();
}

async function migrateStorefrontCatalog() {
  await sql`CREATE TABLE IF NOT EXISTS app_migrations (
    id text PRIMARY KEY, applied_at bigint NOT NULL
  )`;

  const migrationId = '2026-09-13-storefront-categories';
  const { rows } = await sql`SELECT 1 FROM app_migrations WHERE id = ${migrationId} LIMIT 1`;
  if (rows.length > 0) return;

  await sql`UPDATE products SET price = 400`;
  await sql`UPDATE products SET category = 'floral' WHERE name = 'Red Edge Polka'`;
  await sql`UPDATE category_tiles SET label = 'Premium 70cm' WHERE kind = 'product' AND link = '/shop?cat=floral'`;
  await sql`UPDATE category_tiles SET label = 'Premium 90cm' WHERE kind = 'product' AND link = '/shop?cat=solid'`;

  await sql`INSERT INTO category_tiles (id, kind, label, sublabel, link, image, bg_color, "order")
    SELECT 'ct_prod_durags', 'product', 'Durags', '', '/shop?cat=durags', '/durags-category.png', '#171717',
      COALESCE(MAX("order"), 0) + 1
    FROM category_tiles
    WHERE NOT EXISTS (SELECT 1 FROM category_tiles WHERE kind = 'product' AND link = '/shop?cat=durags')`;
  await sql`INSERT INTO category_tiles (id, kind, label, sublabel, link, image, bg_color, "order")
    SELECT 'ct_prod_pant_chains', 'product', 'Pant chains', '', '/shop?cat=pant-chains', '/pant-chains-category.png', '#d6d3d1',
      COALESCE(MAX("order"), 0) + 1
    FROM category_tiles
    WHERE NOT EXISTS (SELECT 1 FROM category_tiles WHERE kind = 'product' AND link = '/shop?cat=pant-chains')`;

  await sql`INSERT INTO app_migrations (id, applied_at) VALUES (${migrationId}, ${Date.now()})
    ON CONFLICT (id) DO NOTHING`;
}

async function seedIfEmpty() {
  const { rows } = await sql`SELECT count(*)::int AS n FROM products`;
  if (rows[0].n > 0) return;
  const now = Date.now();

  const products: Omit<Product, 'createdAt'>[] = [
    { id: 'p1', slug: 'classic-paisley-red', name: 'Classic Paisley Red', description: 'Our signature paisley bandana in deep red — 100% cotton, hemmed edges, 22"×22". A timeless piece for every wardrobe.', price: 400, cost: 0, stock: 50, image: '/placeholder.svg', category: 'classic', featured: true, variants: [] },
    { id: 'p2', slug: 'midnight-blue-paisley', name: 'Midnight Blue Paisley', description: 'Deep navy paisley print on premium cotton. Soft, breathable, perfect for everyday wear.', price: 400, cost: 0, stock: 35, image: '/placeholder.svg', category: 'classic', featured: true, variants: [] },
    { id: 'p3', slug: 'forest-green-tribal', name: 'Forest Green Tribal', description: 'Bold tribal motifs in forest green. Hand-finished edges, premium cotton blend.', price: 400, cost: 0, stock: 20, image: '/placeholder.svg', category: 'tribal', featured: false, variants: [] },
    { id: 'p4', slug: 'sunset-orange-floral', name: 'Sunset Orange Floral', description: 'Vibrant floral pattern on warm orange — a statement piece for sunny days.', price: 400, cost: 0, stock: 28, image: '/placeholder.svg', category: 'floral', featured: true, variants: [] },
    { id: 'p5', slug: 'pure-black-essential', name: 'Pure Black Essential', description: 'The everyday essential. Solid black, no print, premium cotton. Pairs with anything.', price: 400, cost: 0, stock: 80, image: '/placeholder.svg', category: 'solid', featured: false, variants: [] },
    { id: 'p6', slug: 'ivory-white-essential', name: 'Ivory White Essential', description: 'Clean ivory white, solid colour, premium cotton. The minimalist favourite.', price: 400, cost: 0, stock: 60, image: '/placeholder.svg', category: 'solid', featured: false, variants: [] },
  ];
  for (const p of products) {
    await sql`INSERT INTO products (id, slug, name, description, price, stock, image, category, featured, variants, created_at)
      VALUES (${p.id}, ${p.slug}, ${p.name}, ${p.description}, ${p.price}, ${p.stock}, ${p.image}, ${p.category}, ${p.featured}, ${'[]'}::jsonb, ${now})`;
  }

  const banners = [
    { id: 'b1', title: 'Wrap Yourself in Style', subtitle: 'Premium handcrafted bandanas. Made for every adventure.', ctaText: 'Shop the Collection', ctaLink: '/shop', image: '/placeholder.svg', active: true, order: 1 },
    { id: 'b2', title: 'New Arrivals', subtitle: 'Fresh patterns just dropped this season.', ctaText: 'Browse New', ctaLink: '/shop', image: '/placeholder.svg', active: true, order: 2 },
  ];
  for (const b of banners) {
    await sql`INSERT INTO banners (id, title, subtitle, cta_text, cta_link, image, active, "order")
      VALUES (${b.id}, ${b.title}, ${b.subtitle}, ${b.ctaText}, ${b.ctaLink}, ${b.image}, ${b.active}, ${b.order})`;
  }

  const tiles: CategoryTile[] = [
    { id: 'ct_feat_1', kind: 'feature', label: 'CLASSIC PAISLEY BANDANAS', sublabel: 'NEW ARRIVALS', link: '/shop?cat=classic', image: '/placeholder.svg', bgColor: '#1c1917', order: 1 },
    { id: 'ct_feat_2', kind: 'feature', label: 'PREMIUM BANDANAS', sublabel: 'LATEST ARRIVALS', link: '/shop?cat=solid', image: '/placeholder.svg', bgColor: '#f5f5f4', order: 2 },
    { id: 'ct_prod_1', kind: 'product', label: 'Classic', sublabel: '', link: '/shop?cat=classic', image: '/placeholder.svg', bgColor: '#4338ca', order: 3 },
    { id: 'ct_prod_2', kind: 'product', label: 'Tribal', sublabel: '', link: '/shop?cat=tribal', image: '/placeholder.svg', bgColor: '#7dd3fc', order: 4 },
    { id: 'ct_prod_3', kind: 'product', label: 'Floral', sublabel: '', link: '/shop?cat=floral', image: '/placeholder.svg', bgColor: '#ffffff', order: 5 },
    { id: 'ct_prod_4', kind: 'product', label: 'Solids', sublabel: '', link: '/shop?cat=solid', image: '/placeholder.svg', bgColor: '#dc2626', order: 6 },
  ];
  for (const t of tiles) {
    await sql`INSERT INTO category_tiles (id, kind, label, sublabel, link, image, bg_color, "order")
      VALUES (${t.id}, ${t.kind}, ${t.label}, ${t.sublabel}, ${t.link}, ${t.image}, ${t.bgColor}, ${t.order})`;
  }

  await sql`INSERT INTO site_content (id, site_name, tagline, about_title, about_body, contact_email, contact_phone, contact_address, shipping_fee, free_shipping_over, hero_image, hero_headline, hero_subheadline, hero_cta_text, hero_cta_link, return_fee)
    VALUES (1, ${'Rovin Bandana'}, ${'Handcrafted bandanas for the bold.'}, ${'Our Story'},
    ${'Rovin Bandana started with a simple idea: a great bandana is more than fabric. It is a statement, a companion, a piece of personal style. We work with skilled artisans to bring you premium cotton bandanas in patterns that stand out. Every piece is hand-finished and made to last.'},
    ${'hello@rovinbandana.com'}, ${'+91 98765 43210'}, ${'Mumbai, India'}, ${60}, ${1000},
    ${'/hero-banner.jpg'}, ${''}, ${''}, ${'Shop the Collection'}, ${'/shop'}, ${100})
    ON CONFLICT (id) DO NOTHING`;
}

// ---------- public API ----------

export const db = {
  // products
  async listProducts(): Promise<Product[]> {
    return cachedRead('products', async () => {
      await ready();
      const { rows } = await sql`SELECT * FROM products ORDER BY created_at DESC`;
      return rows.map(rowToProduct);
    });
  },
  async featuredProducts(): Promise<Product[]> {
    return cachedRead('featured-products', async () => {
      await ready();
      const { rows } = await sql`SELECT * FROM products WHERE featured = true ORDER BY created_at DESC`;
      return rows.map(rowToProduct);
    });
  },
  async getProduct(id: string): Promise<Product | undefined> {
    await ready();
    const { rows } = await sql`SELECT * FROM products WHERE id = ${id} LIMIT 1`;
    return rows[0] ? rowToProduct(rows[0]) : undefined;
  },
  async getProductBySlug(slug: string): Promise<Product | undefined> {
    await ready();
    const { rows } = await sql`SELECT * FROM products WHERE slug = ${slug} LIMIT 1`;
    return rows[0] ? rowToProduct(rows[0]) : undefined;
  },
  async createProduct(input: Omit<Product, 'id' | 'createdAt' | 'slug' | 'variants' | 'cost'> & { slug?: string; variants?: ProductVariant[]; cost?: number }): Promise<Product> {
    await ready();
    const base = input.slug || slugify(input.name);
    let slug = base;
    let n = 2;
    while ((await sql`SELECT 1 FROM products WHERE slug = ${slug} LIMIT 1`).rows.length) slug = base + '-' + n++;
    const id = uid('p');
    const createdAt = Date.now();
    const variants = input.variants || [];
    const variantStyle = input.variantStyle || 'image';
    const cost = input.cost || 0;
    await sql`INSERT INTO products (id, slug, name, description, price, cost, stock, image, category, featured, variants, variant_style, created_at)
      VALUES (${id}, ${slug}, ${input.name}, ${input.description}, ${input.price}, ${cost}, ${input.stock}, ${input.image}, ${input.category}, ${input.featured}, ${JSON.stringify(variants)}::jsonb, ${variantStyle}, ${createdAt})`;
    invalidateStorefrontCache();
    return { ...input, cost, variants, variantStyle, slug, id, createdAt };
  },
  async updateProduct(id: string, patch: Partial<Product>): Promise<Product | undefined> {
    await ready();
    const cur = await db.getProduct(id);
    if (!cur) return undefined;
    const p = { ...cur, ...patch, id };
    await sql`UPDATE products SET slug=${p.slug}, name=${p.name}, description=${p.description}, price=${p.price}, cost=${p.cost || 0},
      stock=${p.stock}, image=${p.image}, category=${p.category}, featured=${p.featured}, variants=${JSON.stringify(p.variants || [])}::jsonb, variant_style=${p.variantStyle || 'image'} WHERE id=${id}`;
    invalidateStorefrontCache();
    return p;
  },
  async deleteProduct(id: string): Promise<boolean> {
    await ready();
    const { rowCount } = await sql`DELETE FROM products WHERE id = ${id}`;
    invalidateStorefrontCache();
    return (rowCount ?? 0) > 0;
  },
  async setAllProductCosts(cost: number): Promise<number> {
    await ready();
    const { rowCount } = await sql`UPDATE products SET cost = ${cost}`;
    return rowCount ?? 0;
  },

  // orders
  async listOrders(): Promise<Order[]> {
    await ready();
    const { rows } = await sql`SELECT * FROM orders ORDER BY created_at DESC`;
    return rows.map(rowToOrder);
  },
  async getOrder(id: string): Promise<Order | undefined> {
    await ready();
    const { rows } = await sql`SELECT * FROM orders WHERE id = ${id} LIMIT 1`;
    return rows[0] ? rowToOrder(rows[0]) : undefined;
  },
  async createOrder(input: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'status' | 'customerId'> & { customerId?: string }): Promise<Order> {
    await ready();
    const now = Date.now();

    // upsert customer: match by email when provided, otherwise by phone
    const existing = input.customerEmail
      ? (await sql`SELECT * FROM customers WHERE lower(email) = lower(${input.customerEmail}) LIMIT 1`).rows[0]
      : (await sql`SELECT * FROM customers WHERE phone = ${input.customerPhone} AND (email IS NULL OR email = '') LIMIT 1`).rows[0];
    let customerId: string;
    if (existing) {
      customerId = existing.id;
      await sql`UPDATE customers SET
        name=${input.customerName}, phone=${input.customerPhone}, address=${input.shippingAddress},
        city=${input.city}, postal_code=${input.postalCode},
        order_count = order_count + 1, total_spent = total_spent + ${input.total},
        last_order_at = ${now}
        WHERE id=${customerId}`;
    } else {
      customerId = uid('c');
      await sql`INSERT INTO customers (id, name, email, phone, address, city, postal_code, order_count, total_spent, last_order_at, created_at)
        VALUES (${customerId}, ${input.customerName}, ${input.customerEmail}, ${input.customerPhone}, ${input.shippingAddress}, ${input.city}, ${input.postalCode}, ${1}, ${input.total}, ${now}, ${now})`;
    }

    // decrement stock (variant-aware)
    for (const item of input.items) {
      if (item.variantId) {
        const product = await db.getProduct(item.productId);
        if (product && product.variants.length > 0) {
          const nextVariants = product.variants.map((v) =>
            v.id === item.variantId ? { ...v, stock: Math.max(0, v.stock - item.qty) } : v,
          );
          await sql`UPDATE products SET variants=${JSON.stringify(nextVariants)}::jsonb WHERE id = ${item.productId}`;
          continue;
        }
      }
      await sql`UPDATE products SET stock = GREATEST(0, stock - ${item.qty}) WHERE id = ${item.productId}`;
    }

    const id = uid('o');
    const { rows: [{ order_number: orderNumber }] } = await sql`
      INSERT INTO orders (id, order_number, customer_id, customer_name, customer_email, customer_phone, shipping_address, city, postal_code, notes, items, subtotal, shipping, total, status, payment_method, delivery_zone, created_at)
      VALUES (${id}, nextval('order_number_seq'), ${customerId}, ${input.customerName}, ${input.customerEmail}, ${input.customerPhone}, ${input.shippingAddress}, ${input.city}, ${input.postalCode}, ${input.notes}, ${JSON.stringify(input.items)}::jsonb, ${input.subtotal}, ${input.shipping}, ${input.total}, ${'pending'}, ${input.paymentMethod}, ${input.deliveryZone}, ${now})
      RETURNING order_number`;

    return { ...input, customerId, id, orderNumber: Number(orderNumber), status: 'pending', createdAt: now };
  },
  async updateOrderStatus(id: string, status: Order['status']): Promise<Order | undefined> {
    await ready();
    await sql`UPDATE orders SET status = ${status} WHERE id = ${id}`;
    return db.getOrder(id);
  },
  async restockOrderItems(items: Order['items']): Promise<void> {
    await ready();
    for (const item of items) {
      if (item.variantId) {
        const product = await db.getProduct(item.productId);
        if (product && product.variants.length > 0) {
          const nextVariants = product.variants.map((v) =>
            v.id === item.variantId ? { ...v, stock: v.stock + item.qty } : v,
          );
          await sql`UPDATE products SET variants=${JSON.stringify(nextVariants)}::jsonb WHERE id = ${item.productId}`;
          continue;
        }
      }
      await sql`UPDATE products SET stock = stock + ${item.qty} WHERE id = ${item.productId}`;
    }
  },
  async clearOrderPathaoLink(id: string): Promise<void> {
    await ready();
    await sql`UPDATE orders SET pathao_consignment_id = NULL, pathao_delivery_fee = NULL, pathao_collected_amount = NULL WHERE id = ${id}`;
  },
  async updateOrderDeliveryFee(id: string, deliveryFee: number): Promise<void> {
    await ready();
    await sql`UPDATE orders SET pathao_delivery_fee = ${deliveryFee} WHERE id = ${id}`;
  },
  async updateOrderCollectedAmount(id: string, collectedAmount: number): Promise<void> {
    await ready();
    await sql`UPDATE orders SET pathao_collected_amount = ${collectedAmount} WHERE id = ${id}`;
  },
  async findOrderByNumberOrConsignment(key: string): Promise<Order | undefined> {
    await ready();
    const asNumber = Number(key);
    const { rows } = Number.isFinite(asNumber) && key.trim() !== ''
      ? await sql`SELECT * FROM orders WHERE order_number = ${asNumber} OR pathao_consignment_id = ${key} LIMIT 1`
      : await sql`SELECT * FROM orders WHERE pathao_consignment_id = ${key} LIMIT 1`;
    return rows[0] ? rowToOrder(rows[0]) : undefined;
  },
  async updateOrderPathaoConsignment(id: string, consignmentId: string, deliveryFee?: number): Promise<void> {
    await ready();
    if (deliveryFee != null) {
      await sql`UPDATE orders SET pathao_consignment_id = ${consignmentId}, pathao_delivery_fee = ${deliveryFee} WHERE id = ${id}`;
    } else {
      await sql`UPDATE orders SET pathao_consignment_id = ${consignmentId} WHERE id = ${id}`;
    }
  },
  async deleteOrder(id: string): Promise<boolean> {
    await ready();
    const { rowCount } = await sql`DELETE FROM orders WHERE id = ${id}`;
    return (rowCount ?? 0) > 0;
  },
  async resetOrderNumberSequence(start = 1001): Promise<void> {
    await ready();
    await sql.query(`ALTER SEQUENCE order_number_seq RESTART WITH ${start}`);
  },

  // customers
  async listCustomers(): Promise<Customer[]> {
    await ready();
    const { rows } = await sql`SELECT * FROM customers ORDER BY created_at DESC`;
    return rows.map(rowToCustomer);
  },
  async getCustomer(id: string): Promise<Customer | undefined> {
    await ready();
    const { rows } = await sql`SELECT * FROM customers WHERE id = ${id} LIMIT 1`;
    return rows[0] ? rowToCustomer(rows[0]) : undefined;
  },
  async customerOrders(id: string): Promise<Order[]> {
    await ready();
    const { rows } = await sql`SELECT * FROM orders WHERE customer_id = ${id} ORDER BY created_at DESC`;
    return rows.map(rowToOrder);
  },

  // sms history
  async logSms(input: { customerId?: string; phone: string; message: string; status: 'sent' | 'failed'; error?: string }): Promise<void> {
    await ready();
    const id = uid('sms');
    await sql`INSERT INTO sms_history (id, customer_id, phone, message, status, error, sent_at)
      VALUES (${id}, ${input.customerId || null}, ${input.phone}, ${input.message}, ${input.status}, ${input.error || null}, ${Date.now()})`;
  },
  async listRecentSms(limit = 50): Promise<{ id: string; phone: string; status: string; sentAt: number; error: string | null }[]> {
    await ready();
    const { rows } = await sql`SELECT id, phone, status, sent_at, error FROM sms_history ORDER BY sent_at DESC LIMIT ${limit}`;
    return rows.map((r) => ({ id: r.id, phone: r.phone, status: r.status, sentAt: Number(r.sent_at), error: r.error }));
  },

  // banners
  async listBanners(activeOnly = false): Promise<Banner[]> {
    await ready();
    const { rows } = activeOnly
      ? await sql`SELECT * FROM banners WHERE active = true ORDER BY "order" ASC`
      : await sql`SELECT * FROM banners ORDER BY "order" ASC`;
    return rows.map(rowToBanner);
  },
  async getBanner(id: string): Promise<Banner | undefined> {
    await ready();
    const { rows } = await sql`SELECT * FROM banners WHERE id = ${id} LIMIT 1`;
    return rows[0] ? rowToBanner(rows[0]) : undefined;
  },
  async createBanner(input: Omit<Banner, 'id'>): Promise<Banner> {
    await ready();
    const id = uid('b');
    await sql`INSERT INTO banners (id, title, subtitle, cta_text, cta_link, image, active, "order")
      VALUES (${id}, ${input.title}, ${input.subtitle}, ${input.ctaText}, ${input.ctaLink}, ${input.image}, ${input.active}, ${input.order})`;
    return { ...input, id };
  },
  async updateBanner(id: string, patch: Partial<Banner>): Promise<Banner | undefined> {
    await ready();
    const cur = await db.getBanner(id);
    if (!cur) return undefined;
    const b = { ...cur, ...patch, id };
    await sql`UPDATE banners SET title=${b.title}, subtitle=${b.subtitle}, cta_text=${b.ctaText},
      cta_link=${b.ctaLink}, image=${b.image}, active=${b.active}, "order"=${b.order} WHERE id=${id}`;
    return b;
  },
  async deleteBanner(id: string): Promise<boolean> {
    await ready();
    const { rowCount } = await sql`DELETE FROM banners WHERE id = ${id}`;
    return (rowCount ?? 0) > 0;
  },

  // category tiles
  async listCategoryTiles(): Promise<CategoryTile[]> {
    return cachedRead('category-tiles', async () => {
      await ready();
      const { rows } = await sql`SELECT * FROM category_tiles ORDER BY "order" ASC`;
      return rows.map(rowToTile);
    });
  },
  // Category options derived from the homepage product tiles, so the product
  // form dropdown always matches the categories shown on the storefront.
  async listProductCategories(): Promise<{ value: string; label: string }[]> {
    const tiles = await db.listCategoryTiles();
    const out: { value: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const t of tiles.filter((x) => x.kind === 'product')) {
      const m = t.link.match(/[?&]cat=([^&]+)/);
      const value = m ? decodeURIComponent(m[1]) : '';
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push({ value, label: t.label || value });
    }
    return out;
  },
  async getCategoryTile(id: string): Promise<CategoryTile | undefined> {
    await ready();
    const { rows } = await sql`SELECT * FROM category_tiles WHERE id = ${id} LIMIT 1`;
    return rows[0] ? rowToTile(rows[0]) : undefined;
  },
  async updateCategoryTile(id: string, patch: Partial<CategoryTile>): Promise<CategoryTile | undefined> {
    await ready();
    const cur = await db.getCategoryTile(id);
    if (!cur) return undefined;
    const t = { ...cur, ...patch, id };
    await sql`UPDATE category_tiles SET kind=${t.kind}, label=${t.label}, sublabel=${t.sublabel},
      link=${t.link}, image=${t.image}, bg_color=${t.bgColor}, "order"=${t.order} WHERE id=${id}`;
    invalidateStorefrontCache();
    return t;
  },
  async createCategoryTile(tile: Omit<CategoryTile, 'id'>): Promise<CategoryTile> {
    await ready();
    const id = uid('ct');
    const { rows } = await sql`SELECT COALESCE(MAX("order"), 0) + 1 AS next FROM category_tiles`;
    const order = tile.order ?? (rows[0]?.next ?? 1);
    await sql`INSERT INTO category_tiles (id, kind, label, sublabel, link, image, bg_color, "order")
      VALUES (${id}, ${tile.kind}, ${tile.label}, ${tile.sublabel}, ${tile.link}, ${tile.image}, ${tile.bgColor}, ${order})`;
    invalidateStorefrontCache();
    return { ...tile, id, order };
  },
  async deleteCategoryTile(id: string): Promise<void> {
    await ready();
    await sql`DELETE FROM category_tiles WHERE id = ${id}`;
    invalidateStorefrontCache();
  },

  // content
  async getContent(): Promise<SiteContent> {
    return cachedRead('site-content', async () => {
      await ready();
      const { rows } = await sql`SELECT * FROM site_content WHERE id = 1 LIMIT 1`;
      return rowToContent(rows[0]);
    });
  },
  async updateContent(patch: Partial<SiteContent>): Promise<SiteContent> {
    await ready();
    const cur = await db.getContent();
    const c = { ...cur, ...patch };
    await sql`UPDATE site_content SET
      site_name=${c.siteName}, tagline=${c.tagline}, about_title=${c.aboutTitle}, about_body=${c.aboutBody},
      contact_email=${c.contactEmail}, contact_phone=${c.contactPhone}, contact_address=${c.contactAddress},
      shipping_fee=${c.shippingFee}, free_shipping_over=${c.freeShippingOver},
      hero_image=${c.heroImage}, hero_headline=${c.heroHeadline}, hero_subheadline=${c.heroSubheadline},
      hero_cta_text=${c.heroCtaText}, hero_cta_link=${c.heroCtaLink}, return_fee=${c.returnFee}
      WHERE id = 1`;
    invalidateStorefrontCache();
    return c;
  },

  // stats
  async stats() {
    await ready();
    const [p, o, c] = await Promise.all([
      sql`SELECT count(*)::int AS n FROM products`,
      sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE status='pending')::int AS pending,
          COALESCE(sum(total) FILTER (WHERE status <> 'cancelled'), 0) AS revenue FROM orders`,
      sql`SELECT count(*)::int AS n FROM customers`,
    ]);
    return {
      products: p.rows[0].n,
      orders: o.rows[0].n,
      pendingOrders: o.rows[0].pending,
      customers: c.rows[0].n,
      revenue: Number(o.rows[0].revenue),
    };
  },
};
