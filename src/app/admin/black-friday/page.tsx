import { db } from '@/lib/db';
import BlackFridayForm from './BlackFridayForm';

export default async function BlackFridayPage() {
  const campaign = await db.getBlackFridayCampaign();
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Black Friday Sale</h1>
      <p className="text-stone-600 mt-1">
        Automatic quantity discount on the whole cart, no code needed. The site banner and the checkout
        discount both follow this switch. Delivery is never discounted.
      </p>
      <div className="mt-6 max-w-xl">
        <BlackFridayForm initial={campaign} />
      </div>
    </div>
  );
}
