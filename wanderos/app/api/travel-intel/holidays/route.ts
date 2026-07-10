import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { getTravelProfile } from "@/lib/db/tables/travel-profiles";
import { listUpcomingHolidays, planHoliday } from "@/lib/agents/crews/travel-intel/concierge";

export const runtime = "nodejs";
export const maxDuration = 60;

const COUNTRY_NAME: Record<string, string> = {
  BD: "Bangladesh", IN: "India", PK: "Pakistan", LK: "Sri Lanka", NP: "Nepal", BT: "Bhutan", MV: "Maldives",
  TH: "Thailand", MY: "Malaysia", ID: "Indonesia", SG: "Singapore", JP: "Japan", AE: "United Arab Emirates",
  TR: "Turkey", GB: "United Kingdom", FR: "France", IT: "Italy", ES: "Spain", US: "United States", AU: "Australia"
};

/** GET → upcoming holidays + an AI concierge plan for the soonest (uses the saved profile). */
export async function GET(request: NextRequest) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const code = (request.nextUrl.searchParams.get("country") || "BD").toUpperCase();
  const profile = await getTravelProfile(auth.session!.id).catch(() => null);
  const holidays = await listUpcomingHolidays(code);
  let plan = null;
  if (holidays[0]) {
    plan = await planHoliday({
      countryName: COUNTRY_NAME[code] || code, country: code,
      holiday: holidays[0].name, date: holidays[0].date, daysLeft: holidays[0].daysLeft, longWeekend: holidays[0].longWeekend,
      budget: profile?.budget ?? undefined, interests: profile?.interests ?? undefined
    }).catch(() => null);
  }
  return NextResponse.json({ country: code, holidays, plan });
}

const PlanSchema = z.object({ country: z.string().max(4).optional(), holiday: z.string(), date: z.string(), daysLeft: z.number(), longWeekend: z.boolean().optional() });

/** POST → concierge plan for a specific chosen holiday. */
export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const parsed = PlanSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const code = (parsed.data.country || "BD").toUpperCase();
  const profile = await getTravelProfile(auth.session!.id).catch(() => null);
  const plan = await planHoliday({
    countryName: COUNTRY_NAME[code] || code, country: code,
    holiday: parsed.data.holiday, date: parsed.data.date, daysLeft: parsed.data.daysLeft, longWeekend: !!parsed.data.longWeekend,
    budget: profile?.budget ?? undefined, interests: profile?.interests ?? undefined
  });
  return NextResponse.json({ plan });
}
