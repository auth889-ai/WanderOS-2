export const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-coral";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm text-white/75">{label}</span>
        {hint && <span className="text-xs text-mist/80">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
