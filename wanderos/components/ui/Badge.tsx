export function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-white/14 bg-white/8 px-3 py-1 text-xs text-white/72">{children}</span>;
}
