const FALLBACK = "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?q=80&w=1200&auto=format&fit=crop";

export type PreviewData = {
  cover?: string;
  title?: string;
  city?: string;
  country?: string;
  price?: number;
  guests?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  amenities?: string[];
  description?: string;
};

/** Real-time listing-card preview (hero · title · location · price · stats · amenities · description). */
export function LivePreview({ data }: { data: PreviewData }) {
  return (
    <div className="sticky top-24">
      <div className="glass rounded-[28px] p-5 text-white">
        <h3 className="mb-4 text-xl font-semibold">Live Preview</h3>
        <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={data.cover || FALLBACK} alt="" className="h-56 w-full object-cover" />
          <div className="p-5">
            <h4 className="text-2xl font-semibold">{data.title || "Listing title"}</h4>
            <p className="mt-2 text-white/70">
              {data.city || "City"}
              {data.city || data.country ? ", " : ""}
              {data.country || "Country"}
            </p>
            <p className="mt-4 text-3xl font-bold">
              {data.price ? data.price.toLocaleString() : 0}
              <span className="ml-2 text-base font-normal text-white/60">/ night</span>
            </p>
            <p className="mt-3 text-sm text-white/70">
              Guests: {data.guests || 1} · Bedrooms: {data.bedrooms || 1} · Bathrooms: {data.bathrooms || 1}
            </p>
            {data.amenities && data.amenities.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {data.amenities.slice(0, 6).map((a) => (
                  <span key={a} className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">{a}</span>
                ))}
              </div>
            )}
            <p className="mt-5 line-clamp-4 text-sm text-white/65">{data.description || "Your AI-written description will appear here."}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
