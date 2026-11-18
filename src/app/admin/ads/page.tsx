import AdsView from './AdsView';

export default function AdsPage() {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Meta Ads</h1>
      <p className="text-stone-600 mt-1">
        What the ads spent, what the store actually received, and what to change next.
      </p>
      <AdsView />
    </div>
  );
}
