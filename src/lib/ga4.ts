// GA4 Measurement Protocol — server-side event tracking

const MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-Y3XL9ENBXH';
const API_SECRET = process.env.GA4_API_SECRET || '';
const ENDPOINT = `https://www.google-analytics.com/mp/collect`;

type GA4Item = {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
};

type GA4PurchaseParams = {
  clientId: string;
  transactionId: string;
  value: number;
  currency?: string;
  shipping?: number;
  items: GA4Item[];
};

export async function sendGA4Purchase(params: GA4PurchaseParams): Promise<void> {
  if (!API_SECRET) return;

  const url = `${ENDPOINT}?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`;

  const body = {
    client_id: params.clientId,
    events: [
      {
        name: 'purchase',
        params: {
          transaction_id: params.transactionId,
          value: params.value,
          currency: params.currency || 'BDT',
          shipping: params.shipping ?? 0,
          items: params.items,
        },
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error('GA4 MP failed:', res.status, await res.text());
  } catch (err) {
    console.error('GA4 MP error:', err);
  }
}

// Extract GA4 client_id from _ga cookie value.
// _ga cookie format: GA1.1.XXXXXXXXXX.XXXXXXXXXX
// client_id is the last two numeric segments joined by "."
export function extractGA4ClientId(gaCookie: string | undefined): string {
  if (!gaCookie) return `${Date.now()}.${Math.floor(Math.random() * 1e9)}`;
  const parts = gaCookie.split('.');
  if (parts.length >= 4) return `${parts[2]}.${parts[3]}`;
  return gaCookie;
}
