export function Panel({
  children,
  className = ""
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-[8px] border border-white/12 bg-white/[0.065] shadow-glow backdrop-blur-xl ${className}`}>
      {children}
    </section>
  );
}
