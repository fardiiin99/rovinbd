import { db } from '@/lib/db';
import StoreHeader from '@/components/StoreHeader';
import StoreFooter from '@/components/StoreFooter';
import CheckoutForm from './CheckoutForm';
import { isCampaignActive } from '@/lib/pricing';

export default async function CheckoutPage() {
  const [content, campaign] = await Promise.all([db.getContent(), db.getBlackFridayCampaign()]);
  return (
    <>
      <StoreHeader siteName={content.siteName} />
      <main className="flex-1 max-w-4xl mx-auto px-4 py-12 w-full">
        <h1 className="font-display text-3xl font-bold mb-6">Checkout</h1>
        <CheckoutForm campaignActive={isCampaignActive(campaign)} />
      </main>
      <StoreFooter siteName={content.siteName} email={content.contactEmail} phone={content.contactPhone} address={content.contactAddress} />
    </>
  );
}
