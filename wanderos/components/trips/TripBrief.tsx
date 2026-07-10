"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, DollarSign, MapPin, Sparkles, Users } from "lucide-react";
import { createTripPlan } from "@/lib/api/trips";

const inputClass =
  "w-full rounded-[8px] border border-[#f2cfb0] bg-[linear-gradient(180deg,#fffdf8_0%,#fff7ee_100%)] px-3 py-3 text-sm font-medium text-[#483b32] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_12px_30px_rgba(58,38,24,0.14)] outline-none transition duration-200 placeholder:text-[#a98a74] hover:border-[#efb990] hover:bg-[#fffaf3] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_16px_34px_rgba(58,38,24,0.18)] focus:border-[#ff806e] focus:bg-[#fffefd] focus:ring-4 focus:ring-[#ff806e]/20";
const dateInputClass = `${inputClass} trip-date-input pr-12`;

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function DateField({ name }: { name: string }) {
  const inputRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    const input = inputRef.current;
    if (!input) return;
    const picker = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof picker.showPicker === "function") {
      picker.showPicker();
      return;
    }
    input.focus();
  }

  return (
    <div className="relative">
      <input ref={inputRef} name={name} type="date" className={dateInputClass} />
      <button
        type="button"
        onClick={openPicker}
        className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-[8px] border border-[#f1c8aa] bg-[#fff3e6] text-[#d87562] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_8px_18px_rgba(95,54,31,0.12)] transition hover:border-[#ff9a83] hover:bg-[#ffe8dc] focus:outline-none focus:ring-3 focus:ring-[#ff806e]/25"
        aria-label={`Open ${name === "startDate" ? "start" : "end"} date calendar`}
      >
        <CalendarDays className="h-4 w-4" />
      </button>
    </div>
  );
}

export function TripBrief() {
  const router = useRouter();
  const initialDestination = useSearchParams().get("destination") ?? "";
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  async function submit(formData: FormData) {
    setError("");
    const destination = String(formData.get("destination") || "").trim();
    if (!destination) {
      setError("Destination is required.");
      return;
    }

    const budgetValue = Number(formData.get("budget") || 0);
    const payload = {
      title: String(formData.get("title") || "").trim() || `${destination} Trip`,
      destination,
      startDate: String(formData.get("startDate") || "") || undefined,
      endDate: String(formData.get("endDate") || "") || undefined,
      budget: Number.isFinite(budgetValue) && budgetValue > 0 ? budgetValue : undefined,
      travelStyle: String(formData.get("travelStyle") || "").trim() || undefined,
      party: String(formData.get("party") || "").trim() || "solo",
      pace: String(formData.get("pace") || "balanced"),
      interests: splitList(String(formData.get("interests") || "")),
      constraints: {
        food: String(formData.get("food") || "").trim(),
        accessibility: String(formData.get("accessibility") || "").trim(),
        avoid: splitList(String(formData.get("avoid") || ""))
      }
    };

    startTransition(async () => {
      try {
        const result = await createTripPlan(payload);
        router.push(`/trips/${result.tripId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create this trip.");
      }
    });
  }

  return (
    <form action={submit} className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <label>
          <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/56">
            <Sparkles className="h-3.5 w-3.5" /> Trip name
          </span>
          <input name="title" placeholder="Tokyo food and culture week" className={inputClass} />
        </label>
        <label>
          <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/56">
            <MapPin className="h-3.5 w-3.5" /> Destination
          </span>
          <input name="destination" placeholder="Tokyo" defaultValue={initialDestination} className={inputClass} />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <label>
          <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/56">
            <CalendarDays className="h-3.5 w-3.5" /> Start
          </span>
          <DateField name="startDate" />
        </label>
        <label>
          <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/56">
            <CalendarDays className="h-3.5 w-3.5" /> End
          </span>
          <DateField name="endDate" />
        </label>
        <label>
          <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/56">
            <DollarSign className="h-3.5 w-3.5" /> Budget
          </span>
          <input name="budget" type="number" min="0" placeholder="1800" className={inputClass} />
        </label>
        <label>
          <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/56">
            <Users className="h-3.5 w-3.5" /> Party
          </span>
          <input name="party" placeholder="couple" className={inputClass} />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_180px]">
        <label>
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-white/56">Travel style</span>
          <input name="travelStyle" placeholder="food, culture, photography" className={inputClass} />
        </label>
        <label>
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-white/56">Pace</span>
          <select name="pace" defaultValue="balanced" className={inputClass}>
            <option value="relaxed">Relaxed</option>
            <option value="balanced">Balanced</option>
            <option value="packed">Packed</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label>
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-white/56">Interests</span>
          <textarea name="interests" rows={4} placeholder="ramen, museums, night walks" className={inputClass} />
        </label>
        <label>
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-white/56">Food constraints</span>
          <textarea name="food" rows={4} placeholder="no shellfish, vegetarian lunches" className={inputClass} />
        </label>
        <label>
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-white/56">Avoid</span>
          <textarea name="avoid" rows={4} placeholder="expensive fine dining, too many temples" className={inputClass} />
        </label>
      </div>

      <label>
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-white/56">Accessibility</span>
        <input name="accessibility" placeholder="low stairs, slower walking pace" className={inputClass} />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-[8px] bg-white px-4 py-3 text-sm font-semibold text-night transition hover:bg-white/90 disabled:opacity-60"
        >
          <Sparkles className="h-4 w-4" />
          {isPending ? "Creating" : "Plan with AI"}
        </button>
        {error ? <p className="text-sm font-semibold text-coral">{error}</p> : null}
      </div>
    </form>
  );
}
