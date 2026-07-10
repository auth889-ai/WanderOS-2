"use client";

import { useState } from "react";

export function TripPlannerClient() {
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(formData: FormData) {
    setStatus("saving");
    setMessage("");

    const payload = Object.fromEntries(formData.entries());
    const response = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setStatus("error");
      setMessage(body.error || "Could not create this trip.");
      return;
    }

    window.location.reload();
  }

  return (
    <form action={submit} className="grid gap-3">
      <input name="title" placeholder="Trip name" className="rounded-[8px] border border-white/12 bg-black/24 px-3 py-2 text-sm outline-none focus:border-peach" />
      <input name="destination" placeholder="Destination" className="rounded-[8px] border border-white/12 bg-black/24 px-3 py-2 text-sm outline-none focus:border-peach" />
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="startDate" type="date" className="rounded-[8px] border border-white/12 bg-black/24 px-3 py-2 text-sm outline-none focus:border-peach" />
        <input name="endDate" type="date" className="rounded-[8px] border border-white/12 bg-black/24 px-3 py-2 text-sm outline-none focus:border-peach" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="budget" type="number" min="0" placeholder="Budget" className="rounded-[8px] border border-white/12 bg-black/24 px-3 py-2 text-sm outline-none focus:border-peach" />
        <select name="travelStyle" className="rounded-[8px] border border-white/12 bg-black/24 px-3 py-2 text-sm outline-none focus:border-peach">
          <option value="">Travel style</option>
          <option value="slow-local">Slow local</option>
          <option value="food-culture">Food and culture</option>
          <option value="family-comfort">Family comfort</option>
          <option value="luxury-hosted">Luxury hosted</option>
        </select>
      </div>
      <button disabled={status === "saving"} className="rounded-[8px] bg-white px-4 py-3 text-sm font-semibold text-night disabled:opacity-60">
        {status === "saving" ? "Creating..." : "Create trip plan"}
      </button>
      {message ? <p className="text-sm text-coral">{message}</p> : null}
    </form>
  );
}
