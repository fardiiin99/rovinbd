'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GalleryItem } from '@/lib/db';

type ProductOption = { name: string; slug: string; image: string };
type Draft = { id?: string; image: string; link: string; label: string };

const SHOWN_ON_SITE = 4;

export default function GalleryAdmin({ initial, products }: { initial: GalleryItem[]; products: ProductOption[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const productFor = (link: string) => products.find((p) => link === `/product/${p.slug}`);

  const remove = async (id: string) => {
    if (!confirm('Remove this photo from the gallery?')) return;
    setBusy(true);
    await fetch(`/api/admin/gallery/${id}`, { method: 'DELETE' });
    setBusy(false);
    router.refresh();
  };

  // Swap with the neighbour, then rewrite orders as 1..n so gaps or duplicates
  // left by earlier deletes can't turn the swap into a no-op.
  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= initial.length) return;
    const reordered = [...initial];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setBusy(true);
    await Promise.all(
      reordered.map((item, i) =>
        item.order === i + 1
          ? null
          : fetch(`/api/admin/gallery/${item.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ order: i + 1 }),
            }),
      ),
    );
    setBusy(false);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-stone-600">
          {initial.length === 0
            ? 'No photos yet. The homepage shows product photos until you add some.'
            : `${initial.length} photo${initial.length === 1 ? '' : 's'}`}
        </div>
        <button onClick={() => setEditing({ image: '', link: '', label: '' })} className="btn btn-primary text-sm py-1.5 shrink-0">
          + Add Photo
        </button>
      </div>

      <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
        {initial.map((item, i) => {
          const product = productFor(item.link);
          return (
            <div key={item.id} className="card overflow-hidden">
              <div className="relative aspect-square bg-stone-100">
                <img src={item.image} alt={item.label} className="absolute inset-0 h-full w-full object-cover" />
                {i >= SHOWN_ON_SITE && (
                  <span className="absolute left-2 top-2 rounded bg-stone-900/80 px-2 py-0.5 text-[11px] text-white">
                    Not shown (only first 4)
                  </span>
                )}
              </div>
              <div className="p-3">
                <div className="text-sm font-semibold truncate">
                  {product ? product.name : item.label || <em className="text-stone-400">No label</em>}
                </div>
                <div className="text-xs text-stone-500 truncate">→ {item.link}</div>
                <div className="grid grid-cols-[auto_auto_1fr_auto] gap-1.5 mt-3">
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="btn btn-outline text-sm py-1.5 px-2.5 disabled:opacity-30" aria-label="Move earlier">←</button>
                  <button onClick={() => move(i, 1)} disabled={i === initial.length - 1} className="btn btn-outline text-sm py-1.5 px-2.5 disabled:opacity-30" aria-label="Move later">→</button>
                  <button
                    onClick={() => setEditing({ id: item.id, image: item.image, link: item.link, label: item.label })}
                    className="btn btn-outline text-sm py-1.5 px-2 min-w-0"
                  >
                    Edit
                  </button>
                  <button onClick={() => remove(item.id)} className="btn text-sm py-1.5 px-2.5 border border-red-200 text-red-600 rounded hover:bg-red-50" aria-label="Remove">✕</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {editing && <GalleryEditor initial={editing} products={products} onClose={() => setEditing(null)} />}
    </div>
  );
}

function GalleryEditor({ initial, products, onClose }: { initial: Draft; products: ProductOption[]; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selectedSlug = products.find((p) => form.link === `/product/${p.slug}`)?.slug ?? '';

  const onFile = async (file: File) => {
    setUploading(true);
    setError('');
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/admin/upload', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    setUploading(false);
    if (res.ok && data.url) setForm((f) => ({ ...f, image: data.url }));
    else setError(data.error || 'Upload failed. Try a smaller photo.');
  };

  const pickProduct = (slug: string) => {
    const p = products.find((x) => x.slug === slug);
    if (p) setForm((f) => ({ ...f, link: `/product/${p.slug}`, label: p.name }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.image) {
      setError('Upload a photo first.');
      return;
    }
    setSaving(true);
    const res = await fetch(form.id ? `/api/admin/gallery/${form.id}` : '/api/admin/gallery', {
      method: form.id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: form.image, link: form.link, label: form.label }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Could not save.');
      return;
    }
    onClose();
    router.refresh();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="card p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
        <h3 className="font-semibold text-lg">{form.id ? 'Edit Gallery Photo' : 'Add Gallery Photo'}</h3>

        <div>
          <label className="label">Photo</label>
          <div className="flex items-start gap-3">
            <div className="w-28 h-28 rounded border border-stone-200 overflow-hidden flex-shrink-0 bg-stone-100">
              {form.image && <img src={form.image} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="flex-1">
              <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              <p className="text-xs text-stone-500 mt-1">Shown as a square, so a square photo works best.</p>
              {uploading && <div className="text-xs text-stone-500 mt-1">Uploading…</div>}
            </div>
          </div>
        </div>

        <div>
          <label className="label">Product (the bag button opens it)</label>
          <select className="input" value={selectedSlug} onChange={(e) => pickProduct(e.target.value)}>
            <option value="">— Custom link —</option>
            {products.map((p) => (
              <option key={p.slug} value={p.slug}>{p.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Link</label>
          <input className="input" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="/shop" />
          <p className="text-xs text-stone-500 mt-1">Filled in when you pick a product. For a category use e.g. <code>/shop?cat=durags</code>.</p>
        </div>

        <div>
          <label className="label">Label</label>
          <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Black Satin Durag" />
          <p className="text-xs text-stone-500 mt-1">Not shown on the photo; used for accessibility and search engines.</p>
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="flex gap-2 pt-2">
          <button disabled={saving || uploading} className="btn btn-primary">{saving ? 'Saving…' : form.id ? 'Save' : 'Add'}</button>
          <button type="button" onClick={onClose} className="btn btn-outline">Cancel</button>
        </div>
      </form>
    </div>
  );
}
