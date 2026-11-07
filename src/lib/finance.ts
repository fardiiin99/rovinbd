import type { Order, Product, SiteContent } from './db';

export type FinanceOrderRow = {
  id: string;
  orderNumber: number;
  customerName: string;
  status: Order['status'];
  total: number;
  revenue: number;
  cogs: number;
  deliveryFee: number;
  deliveryFeeIsEstimate: boolean;
  deliveryProfit: number;
  returnDeduction: number;
  pathaoConsignmentId: string | null;
  createdAt: number;
};

export type FinanceSummary = {
  revenue: number;
  cogs: number;
  deliveryCost: number;
  deliveryProfit: number;
  returnCost: number;
  netProfit: number;
  deliveredCount: number;
  deliveredWithCollectionCount: number;
  deliveredCollectedRevenue: number;
  returnedCount: number;
  paidReturnCount: number;
  pendingCount: number;
  pendingValue: number;
};

export function computeFinance(
  allOrders: Order[],
  products: Product[],
  _content: SiteContent,
  from = 0,
  to = Infinity,
): { summary: FinanceSummary; orders: FinanceOrderRow[] } {
  const costByProduct = new Map(products.map((p) => [p.id, p.cost || 0]));
  const orders = allOrders.filter((o) => o.createdAt >= from && o.createdAt <= to);

  let revenue = 0;
  let cogs = 0;
  let deliveryCost = 0;
  let deliveryProfit = 0;
  let returnCost = 0;
  let deliveredCount = 0;
  let deliveredWithCollectionCount = 0;
  let deliveredCollectedRevenue = 0;
  let returnedCount = 0;
  let paidReturnCount = 0;
  let pendingCount = 0;
  let pendingValue = 0;

  const rows: FinanceOrderRow[] = orders.map((o) => {
    const itemCost = o.items.reduce((s, i) => s + i.qty * (costByProduct.get(i.productId) || 0), 0);
    const deliveryFee = o.pathaoDeliveryFee ?? o.shipping;
    const hasRealFee = o.pathaoDeliveryFee != null;
    const rowDeliveryProfit = hasRealFee ? o.shipping - o.pathaoDeliveryFee! : 0;

    let rowRevenue = 0;
    let rowCogs = 0;
    let rowReturnDeduction = 0;

    if (o.status === 'received') {
      deliveredCount++;
      if (o.pathaoCollectedAmount != null && o.pathaoCollectedAmount > 0) {
        deliveredWithCollectionCount++;
        deliveredCollectedRevenue += o.pathaoCollectedAmount;
      }
      // Use Pathao's real collected amount when known (covers partial COD, etc.), otherwise the order total.
      rowRevenue = o.pathaoCollectedAmount ?? o.total;
      rowCogs = itemCost;
      revenue += rowRevenue;
      cogs += rowCogs;
      deliveryCost += deliveryFee;
      deliveryProfit += rowDeliveryProfit;
    } else if (o.status === 'returned') {
      returnedCount++;
      const isPaidReturn = !!o.pathaoCollectedAmount;
      if (isPaidReturn) {
        // Paid Return: Pathao still collected some amount even though the parcel came back —
        // that's real revenue. Goods return to stock, so no COGS. Out-of-pocket cost is just
        // 50% of the delivery fee.
        rowRevenue = o.pathaoCollectedAmount!;
        revenue += rowRevenue;
        paidReturnCount++;
        rowReturnDeduction = deliveryFee * 0.5;
      } else {
        // Plain return: nothing collected. Out-of-pocket cost is the delivery fee plus a
        // 50% return fee (i.e. 1.5x the delivery fee).
        rowReturnDeduction = deliveryFee * 1.5;
      }
      returnCost += rowReturnDeduction;
    } else {
      pendingCount++;
      pendingValue += o.total;
    }

    return {
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      status: o.status,
      total: o.total,
      revenue: rowRevenue,
      cogs: rowCogs,
      deliveryFee,
      deliveryFeeIsEstimate: !hasRealFee,
      deliveryProfit: rowDeliveryProfit,
      returnDeduction: rowReturnDeduction,
      pathaoConsignmentId: o.pathaoConsignmentId || null,
      createdAt: o.createdAt,
    };
  });

  const netProfit = revenue - cogs - deliveryCost - returnCost;

  return {
    summary: {
      revenue, cogs, deliveryCost, deliveryProfit, returnCost, netProfit,
      deliveredCount, deliveredWithCollectionCount, deliveredCollectedRevenue,
      returnedCount, paidReturnCount, pendingCount, pendingValue,
    },
    orders: rows.sort((a, b) => b.createdAt - a.createdAt),
  };
}
