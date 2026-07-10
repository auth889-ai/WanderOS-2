type Variant = "primary" | "ghost";

const styles: Record<Variant, string> = {
  primary: "bg-gradient-to-r from-coral to-mist text-night shadow-coral hover:brightness-110",
  ghost: "border border-white/12 bg-white/5 text-white hover:bg-white/10"
};

export function Button({
  children,
  variant = "primary",
  className = "",
  ...rest
}: { children: React.ReactNode; variant?: Variant } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`rounded-2xl px-6 py-3.5 text-sm font-semibold transition disabled:opacity-60 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
