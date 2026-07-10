import { AppShell } from "@/components/AppShell";

export default function OnboardingPage() {
  return (
    <AppShell>
      <section className="mx-auto max-w-3xl rounded-[8px] border border-white/12 bg-white/[0.065] p-6 shadow-glow">
        <p className="text-xs uppercase tracking-[0.22em] text-peach">Onboarding</p>
        <h1 className="mt-2 text-4xl font-semibold">Teach WanderOS how you travel</h1>
        <div className="mt-7 grid gap-4 md:grid-cols-2">
          {["Home city", "Budget level", "Monthly travel budget", "Travel style", "Preferred pace", "Favorite destinations"].map((label) => (
            <label key={label} className="block">
              <span className="text-xs text-white/52">{label}</span>
              <input className="mt-1 w-full rounded-[8px] border border-white/12 bg-black/20 px-3 py-2 outline-none focus:border-peach" placeholder={label} />
            </label>
          ))}
        </div>
        <button className="mt-6 rounded-[8px] bg-white px-5 py-3 text-sm font-semibold text-night">Save profile</button>
      </section>
    </AppShell>
  );
}
