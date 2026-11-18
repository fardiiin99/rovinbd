import type { Order } from './db';
import { sendSMS } from './sms';
import { db } from './db';

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';
const ADMIN_SMS_PHONE = process.env.ADMIN_SMS_PHONE || '';

function fmt(amount: number): string {
  return `৳${amount.toLocaleString('en-BD')}`;
}

export async function notifyTelegram(order: Order): Promise<void> {
  if (!TG_TOKEN || !TG_CHAT) return;
  const lines = [
    `🛍️ <b>New Order #${order.orderNumber}</b>`,
    ``,
    `<b>Customer:</b> ${order.customerName}`,
    `<b>Phone:</b> ${order.customerPhone}`,
    order.customerEmail ? `<b>Email:</b> ${order.customerEmail}` : '',
    `<b>Address:</b> ${order.shippingAddress}, ${order.city}`,
    `<b>Delivery:</b> ${order.deliveryZone === 'outside_dhaka' ? 'Outside Dhaka' : 'Inside Dhaka'} (${fmt(order.shipping)})`,
    ``,
    `<b>Items:</b>`,
    ...order.items.map((i) => `• ${i.name} × ${i.qty} — ${fmt(i.price * i.qty)}`),
    ``,
    `<b>Subtotal:</b> ${fmt(order.subtotal)}`,
    order.discountAmount > 0 ? `<b>${order.discountLabel || 'Discount'} (${order.discountPercent}%):</b> −${fmt(order.discountAmount)}` : '',
    `<b>Total:</b> ${fmt(order.total)}`,
    `<b>Payment:</b> Cash on Delivery`,
    order.notes ? `\n<b>Notes:</b> ${order.notes}` : '',
    ``,
    `<a href="https://www.rovinbd.com/admin/orders/${order.id}">View in admin →</a>`,
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: lines, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) console.error('Telegram notify failed:', res.status, await res.text());
  } catch (err) {
    console.error('Telegram notify error:', err);
  }
}

export async function notifySmsCustomer(order: Order): Promise<{ ok: boolean; error?: string }> {
  const firstName = order.customerName.trim().split(/\s+/)[0];
  const itemLines = order.items
    .map((i) => `${i.name}${i.variantName ? ` (${i.variantName})` : ''} x${i.qty}`)
    .join(', ');
  const message =
    `Hi ${firstName}, your Rovin. order #${order.orderNumber} is confirmed!\n` +
    `Items: ${itemLines}\n` +
    `Total: ${fmt(order.total)} (Cash on Delivery)\n` +
    `We'll notify you once dispatched. Thank you!`;

  const result = await sendSMS(order.customerPhone, message);
  if (!result.ok) console.error('Customer SMS failed:', result.error);
  await db.logSms({
    customerId: order.customerId,
    phone: order.customerPhone,
    message,
    status: result.ok ? 'sent' : 'failed',
    error: result.ok ? undefined : result.error,
  });
  return result;
}

export async function notifySmsAdmin(order: Order): Promise<void> {
  if (!ADMIN_SMS_PHONE) return;
  const itemLines = order.items
    .map((i) => `${i.name}${i.variantName ? ` (${i.variantName})` : ''} x${i.qty}`)
    .join(', ');
  const message =
    `New Order #${order.orderNumber} - Rovin.\n` +
    `Customer: ${order.customerName} (${order.customerPhone})\n` +
    `Address: ${order.shippingAddress}, ${order.city}\n` +
    `Items: ${itemLines}\n` +
    `Total: ${fmt(order.total)} (COD)`;

  const result = await sendSMS(ADMIN_SMS_PHONE, message);
  if (!result.ok) console.error('Admin SMS failed:', result.error);
}

export async function notifyOrderPlaced(order: Order): Promise<void> {
  await notifyTelegram(order);
}
