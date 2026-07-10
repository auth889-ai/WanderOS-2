"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarCheck, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

const input = "w-full rounded-xl border border-white/12 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-coral";

/** Booking widget — pick dates + guests, see the total, Reserve (instant confirm, no payment rail). */
export function BookingWidget({ listingId, pricePerNight, maxGuests }: { listingId: string; pricePerNight: number; maxGuests: number }) {
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guests, setGuests] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [booked, setBooked] = useState<{ nights: number; total: number } | null>(null);

  const nights = checkIn && checkOut ? Math.max(0, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000)) : 0;
  const total = nights * pricePerNight;

  async function reserve() {
    setBusy(true); setError("");
    const r = await fetch("/api/bookings", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, checkIn, checkOut, guests })
    });
    if (r.status === 401) { setError("login"); setBusy(false); return; }
    const data = (await r.json().catch(() => ({}))) as { error?: string; booking?: { nights: number; total_amount: string } };
    if (!r.ok || !data.booking) { setError(data.error || "Could not reserve"); setBusy(false); return; }
    setBooked({ nights: data.booking.nights, total: Number(data.booking.total_amount) });
    setBusy(false);
  }

  if (booked) {
    return (
      <div className="glass rounded-[24px] p-6 text-white">
        <div className="flex items-center gap-2 text-aurora"><CheckCircle2 size={20} /><span className="font-semibold">Booked!</span></div>
        <p className="mt-2 text-sm text-white/70">{booked.nights} night{booked.nights > 1 ? "s" : ""} confirmed.</p>
        <p className="mt-1 text-2xl font-bold">{booked.total.toLocaleString()} <span className="text-sm font-normal text-white/55">total</span></p>
        <Link href="/trips" className="mt-4 inline-block text-sm text-mist hover:text-white">View my trips →</Link>
      </div>
    );
  }

  return (
    <div className="glass rounded-[24px] p-6 text-white">
      <p className="text-2xl font-bold">{pricePerNight.toLocaleString()}<span className="ml-1 text-sm font-normal text-white/55">/ night</span></p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-xs text-white/55">Check-in<input type="date" className={`${input} mt-1`} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></label>
        <label className="text-xs text-white/55">Check-out<input type="date" className={`${input} mt-1`} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></label>
      </div>
      <label className="mt-3 block text-xs text-white/55">Guests
        <select className={`${input} mt-1`} value={guests} onChange={(e) => setGuests(Number(e.target.value))}>
          {Array.from({ length: maxGuests }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} guest{n > 1 ? "s" : ""}</option>)}
        </select>
      </label>

      {nights > 0 && (
        <div className="mt-4 space-y-1 border-t border-white/10 pt-4 text-sm text-white/70">
          <div className="flex justify-between"><span>{pricePerNight.toLocaleString()} × {nights} night{nights > 1 ? "s" : ""}</span><span>{total.toLocaleString()}</span></div>
          <div className="flex justify-between pt-1 text-base font-semibold text-white"><span>Total</span><span>{total.toLocaleString()}</span></div>
        </div>
      )}

      <Button onClick={reserve} disabled={busy || nights < 1} className="mt-4 inline-flex w-full items-center justify-center gap-2">
        <CalendarCheck size={16} /> {busy ? "Reserving…" : "Reserve"}
      </Button>

      {error === "login" ? (
        <p className="mt-3 text-center text-sm text-white/70">Please <Link href="/login" className="text-coral underline">log in as a traveler</Link> to book.</p>
      ) : error ? (
        <p className="mt-3 rounded-xl border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-peach">{error}</p>
      ) : null}
    </div>
  );
}
