import { NextRequest, NextResponse } from "next/server";

import { toWorkerPayload, recordProtection } from "@/lib/db/tables/commitments";
import { getTripById } from "@/lib/db/tables/trips";

/**
 * GET  /api/trips/:id/pulse   the board for a REAL trip
 * POST /api/trips/:id/pulse   record that Guardian acted, then rebuild it
 *
 * This is the join. The commitments come from the database (put there by
 * photographing a confirmation), the live flight delay comes from the flight
 * status service, and the cascade + board come from the media worker. No part
 * of the result is authored here — this route only carries data between things
 * that already existed and never spoke to each other.
 */

const WORKER = process.env.MEDIA_WORKER_URL ?? "http://127.0.0.1:8000";

/**
 * A Postgres `date` column arrives as a JS Date and serialises with a timezone
 * shift: a stored 2026-08-04 becomes "2026-08-03T18:00:00Z" east of UTC. Taking
 * the UTC date would silently move the whole trip a day earlier, so the
 * calendar fields are read in local time and formatted back to a bare date.
 */
function calendarDate(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const d = value as Date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

async function buildBoard(tripId: string) {
  const trip = await getTripById(tripId);
  if (!trip) return null;

  const { commitments, dependencies, protections } = await toWorkerPayload(tripId);

  // Live flight status where we have a flight. A stale delay produces a
  // confident board about a situation that has already changed, so a failure
  // here degrades to "no delay known" rather than to a remembered number.
  let flight: Record<string, unknown> = {};
  const flightCommitment = commitments.find((c) => c.kind === "flight");
  if (flightCommitment) {
    const iata = flightCommitment.label.replace(/^Flight\s+/i, "").trim();
    try {
      const status = await fetch(`${WORKER}/disruption/flight-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flight_iata: iata }),
        signal: AbortSignal.timeout(8000),
        cache: "no-store"
      });
      if (status.ok) flight = await status.json();
    } catch {
      flight = { flight_iata: iata, delay_minutes: 0, status_unavailable: true };
    }
  }

  const response = await fetch(`${WORKER}/journey/pulse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      destination: trip.destination,
      start_date: calendarDate(trip.start_date),
      end_date: calendarDate(trip.end_date),
      flight,
      commitments,
      dependencies,
      protections: protections.map((p) => ({
        commitment_key: p.commitment_key,
        action: p.action,
        acted_by: p.acted_by
      }))
    }),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`worker returned ${response.status}`);

  const board = await response.json();

  return { ...board, trip_id: tripId, title: trip.title };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const board = await buildBoard(id);
    if (!board) return NextResponse.json({ error: "trip not found" }, { status: 404 });
    return NextResponse.json(board);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "could not build the board" },
      { status: 502 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  if (!body?.commitment_key || !body?.action?.trim()) {
    // A protection with no named action would be the product claiming credit
    // for nothing.
    return NextResponse.json(
      { error: "a protection must name the commitment and what was done" },
      { status: 400 }
    );
  }

  try {
    await recordProtection(id, {
      commitment_key: body.commitment_key,
      action: body.action,
      acted_by: body.acted_by ?? "guardian",
      reversible_until: body.reversible_until ?? null
    });
    return NextResponse.json(await buildBoard(id));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "could not record the action" },
      { status: 500 }
    );
  }
}
