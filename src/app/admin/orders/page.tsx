import { db } from '@/lib/db';
import { formatPrice, formatDate } from '@/lib/format';
import OrdersTable from './OrdersTable';

export default async function OrdersAdmin() {
  const orders = await db.listOrders();
  const rows = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    customerName: o.customerName,
    customerEmail: o.customerEmail,
    date: formatDate(o.createdAt),
    qty: o.items.reduce((s, i) => s + i.qty, 0),
    payment: o.paymentMethod === 'cod' ? 'COD' : 'Bank',
    total: formatPrice(o.total),
    status: o.status,
    pathaoConsignmentId: o.pathaoConsignmentId,
  }));

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Orders</h1>
      <p className="text-stone-600 mt-1">{orders.length} total</p>
      <OrdersTable orders={rows} />
    </div>
  );
}
