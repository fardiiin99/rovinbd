'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Product, ProductVariant } from '@/lib/db';
import { uploadAdminImage } from '@/lib/uploadImage';
import VariantsEditor from './VariantsEditor';

type CategoryOption = { value: string; label: string };

export default function ProductForm({ product, categories = [] }: { product?: Product; categories?: CategoryOption[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: product?.name || '',
    description: product?.description || '',
    price: product?.price ?? 0,
    cost: product?.cost ?? 0,
    stock: product?.stock ?? 0,
    image: product?.image || '/placeholder.svg',
    category: product?.category || categories[0]?.value || 'classic',
    featured: product?.featured ?? false,
    variantStyle: (product?.variantStyle ?? 'image') as 'image' | 'size',
  });
  const [variants, setVariants] = useState<ProductVariant[]>(product?.variants || []);

  // Ensure the product's current category is always selectable, even if it's
  // no longer one of the configured tiles.
  const options: CategoryOption[] = [...categories];
  if (form.category && !options.some((o) => o.value === form.category)) {
    options.push({ value: form.category, label: form.category });
  }
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onFile = async (file: File) => {
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    setError('');
    try {
      const url = await uploadAdminImage(file);
      setForm((f) => ({ ...f, image: url }));
      setPending(true);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    const url = product ? `/api/admin/products/${product.id}` : '/api/admin/products';
    const method = product ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, price: Number(form.price), cost: Number(form.cost), stock: Number(form.stock), variants }),
    });
    if (res.ok) {
      router.push('/admin/products');
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || 'Save failed');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="card p-6 space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2"><label className="label">Name</label><input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="sm:col-span-2"><label className="label">Description</label><textarea required rows={4} className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div><label className="label">Price (৳)</label><input type="number" min={0} required className="input" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} /></div>
        <div><label className="label">Cost (৳) <span className="text-xs text-stone-500 font-normal">(what it costs you — used for profit/loss)</span></label><input type="number" min={0} className="input" value={form.cost} onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })} /></div>
        <div>
          <label className="label">Stock {variants.length > 0 && <span className="text-xs text-stone-500 font-normal">(ignored — see variants)</span>}</label>
          <input type="number" min={0} required className="input disabled:bg-stone-100" disabled={variants.length > 0} value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} />
        </div>
        <div><label className="label">Category</label>
          <select className="input" value={form.category} onChange={(e) => {
            const cat = e.target.value;
            const isAcid = cat.toLowerCase().replace(/\s+/g, '-').includes('acid');
            setForm((f) => ({ ...f, category: cat, variantStyle: isAcid && f.variantStyle === 'image' ? 'size' : f.variantStyle }));
          }}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} />
            <span>Featured product</span>
          </label>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Image</label>
          <div className="flex items-center gap-4">
            <img src={preview || form.image} alt="" className="w-24 h-24 object-cover rounded border border-stone-200" />
            <div>
              <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              {uploading && <div className="text-sm text-stone-500 mt-1">Uploading…</div>}
              {pending && !uploading && <div className="text-xs text-amber-600 mt-1">Committed — live on the site in ~1–2 min after the auto-deploy finishes.</div>}
              <div className="text-xs text-stone-500 mt-1">Or paste URL:</div>
              <input className="input mt-1" value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} />
            </div>
          </div>
        </div>
      </div>
      <div className="pt-2 border-t border-stone-200">
        <VariantsEditor variants={variants} onChange={setVariants} variantStyle={form.variantStyle} />
        {variants.length > 0 && (
          <div className="mt-4">
            <label className="label">Variant display</label>
            <div className="flex gap-2 mt-1">
              <button
                type="button"
                onClick={() => setForm({ ...form, variantStyle: 'image' })}
                className={`px-4 py-2 rounded-md border text-sm transition ${form.variantStyle === 'image' ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-700 border-stone-300 hover:border-stone-500'}`}
              >
                Image swatches
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, variantStyle: 'size' })}
                className={`px-4 py-2 rounded-md border text-sm transition ${form.variantStyle === 'size' ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-700 border-stone-300 hover:border-stone-500'}`}
              >
                Size buttons (S / M / L / XL)
              </button>
            </div>
            <p className="text-xs text-stone-500 mt-1">Size buttons shows variant names as text pills — no images needed.</p>
          </div>
        )}
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <div className="flex gap-3">
        <button disabled={saving} className="btn btn-primary">{saving ? 'Saving…' : product ? 'Save Changes' : 'Add Product'}</button>
        <button type="button" onClick={() => router.back()} className="btn btn-outline">Cancel</button>
      </div>
    </form>
  );
}
