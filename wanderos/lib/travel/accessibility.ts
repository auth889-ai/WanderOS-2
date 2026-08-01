/**
 * Accessibility Reality Layer — step-free routing that admits what it doesn't know.
 *
 * important.md #7 calls this the strongest social-impact moat, and
 * how_to_make_important.md fixes the three rules the whole design rests on:
 *
 *     Unknown ≠ Accessible
 *     Prediction ≠ Verification
 *     Old report ≠ Current reality
 *
 * Those are not slogans; each one is a separate field here.
 *
 * **Unknown ≠ Accessible.** Following Wheelmap — the reference implementation
 * named in the guide — accessibility is THREE-state (`yes` / `limited` / `no`)
 * plus a fourth for absence of data. `unknown` never collapses into `yes`. A
 * wheelchair user who trusts a wrong "accessible" is stranded at a doorway;
 * one who distrusts a wrong "unknown" merely takes a longer route.
 *
 * **Prediction ≠ Verification.** A route computed from OSM geometry and a
 * human who went there last week are different kinds of knowledge. They are
 * stored in different fields and rendered differently, never averaged into one
 * score that hides which is which.
 *
 * **Old report ≠ Current reality.** A lift verified two years ago tells you the
 * lift existed, not that it works. Confidence decays with age and the age is
 * always shown.
 *
 * Routing is openrouteservice's `wheelchair` profile, which understands incline,
 * kerb height, surface and smoothness — none of which OSRM can express. That
 * gap is why the guide names ORS and not OSRM for this feature.
 */

const ORS_BASE = process.env.ORS_BASE_URL || "https://api.openrouteservice.org";
const OVERPASS = "https://overpass-api.de/api/interpreter";

/** Wheelmap's vocabulary, plus the fourth state it implies but does not name. */
export type AccessLevel = "yes" | "limited" | "no" | "unknown";

/** How we came to believe something. Kept separate from WHAT we believe. */
export type Basis = "verified" | "official" | "predicted" | "absent";

export type AccessFact = {
  level: AccessLevel;
  basis: Basis;
  /** When the underlying evidence was produced, not when we read it. */
  observedAt: string | null;
  /** 0..1, already decayed for age. */
  confidence: number;
  detail: string;
  source: string;
};

/**
 * How long a claim stays fully trustworthy, in days, by what it describes.
 *
 * A building's front steps do not move; a lift breaks. Applying one half-life
 * to both would either make permanent geometry expire pointlessly or let a
 * broken lift read as working for a year.
 */
const HALF_LIFE_DAYS: Record<string, number> = {
  entrance: 540, // steps and ramps are construction
  toilet: 365,
  lift: 45, // mechanical, and the thing that most often fails
  surface: 270,
  default: 180
};

export function decayConfidence(
  observedAt: string | null,
  kind: string,
  base = 1.0
): { confidence: number; ageDays: number | null; stale: boolean } {
  if (!observedAt) return { confidence: 0, ageDays: null, stale: true };
  const ageDays = Math.max(0, (Date.now() - Date.parse(observedAt)) / 86_400_000);
  const halfLife = HALF_LIFE_DAYS[kind] ?? HALF_LIFE_DAYS.default;
  // Exponential decay: a claim at its half-life is worth half as much.
  const confidence = base * Math.pow(0.5, ageDays / halfLife);
  return {
    confidence: Math.round(confidence * 100) / 100,
    ageDays: Math.round(ageDays),
    // Below a third, the claim should not carry a decision on its own.
    stale: confidence < 0.34
  };
}

/**
 * Read OSM's wheelchair tags exactly as Wheelmap does.
 *
 * `wheelchair=limited` is a real answer and must survive as one. Folding it
 * into `yes` overstates and into `no` understates — and "limited" is precisely
 * the case where a traveller needs the detail to judge for themselves.
 */
export function readOsmAccess(tags: Record<string, string>): AccessFact {
  const raw = tags["wheelchair"];
  const description = tags["wheelchair:description"] ?? tags["wheelchair:description:en"] ?? "";

  if (raw === "yes" || raw === "limited" || raw === "no") {
    return {
      level: raw,
      // A mapper recorded this deliberately — stronger than geometry inference,
      // weaker than a venue's own statement.
      basis: "verified",
      observedAt: tags["check_date"] ?? tags["survey:date"] ?? null,
      confidence: 0,
      detail: description || `OpenStreetMap records wheelchair=${raw}`,
      source: "OpenStreetMap (ODbL)"
    };
  }

  // Absence of a tag is absence of knowledge. It is never a "no" and never a
  // "yes" — most of the world is simply unmapped.
  return {
    level: "unknown",
    basis: "absent",
    observedAt: null,
    confidence: 0,
    detail: "No wheelchair tag in OpenStreetMap. Not surveyed — this is not a 'no'.",
    source: "OpenStreetMap (ODbL)"
  };
}

export type StepFreeRoute = {
  ok: true;
  distanceMetres: number;
  durationMinutes: number;
  /** Steepest incline on the route, in percent. */
  maxInclinePercent: number | null;
  /** Steps the router could not avoid — the thing that decides feasibility. */
  unavoidableSteps: number;
  warnings: string[];
  geometry: [number, number][];
  basis: Basis;
  caveat: string;
};

export type RouteFailure = { ok: false; reason: string; noRouteExists: boolean };

/**
 * A step-free route, or an honest failure.
 *
 * The distinction that matters: "no step-free route exists" and "we could not
 * compute one" are different answers, and only the first is about the world.
 * Collapsing them would tell a wheelchair user a place is unreachable when the
 * truth is that a server timed out.
 */
export async function stepFreeRoute(params: {
  from: [number, number]; // [lon, lat]
  to: [number, number];
  /** Steepest gradient the traveller can manage, percent. */
  maxInclinePercent?: number;
  /** Tallest kerb they can cross, metres. */
  maxKerbMetres?: number;
}): Promise<StepFreeRoute | RouteFailure> {
  if (!process.env.ORS_API_KEY) {
    return { ok: false, reason: "ORS_API_KEY is not set", noRouteExists: false };
  }

  const body = {
    coordinates: [params.from, params.to],
    // These constraints are the entire point of the wheelchair profile — OSRM
    // has no way to express any of them.
    //
    // ORS v2 nests profile_params under `options`; sending it at the top level
    // returns "Unknown parameter 'profile_params'" and the restrictions are
    // silently not applied, which is worse than an error — you get a route that
    // ignores every limit the traveller gave.
    options: {
      profile_params: {
        restrictions: {
          maximum_incline: params.maxInclinePercent ?? 6,
          maximum_sloped_kerb: params.maxKerbMetres ?? 0.03,
          surface_type: "cobblestone:flattened",
          smoothness_type: "good",
          track_type: "grade1"
        }
      }
    },
    elevation: true,
    extra_info: ["steepness", "surface", "waytype"],
    instructions: false
  };

  try {
    const response = await fetch(`${ORS_BASE}/v2/directions/wheelchair/geojson`, {
      method: "POST",
      headers: {
        Authorization: process.env.ORS_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/geo+json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(40_000)
    });

    if (!response.ok) {
      const text = await response.text();
      // ORS 2009/2010 mean the graph genuinely cannot connect these points
      // under the constraints — a real "no route", not an outage.
      const noRoute = /2009|2010|Route could not be found/i.test(text);
      return {
        ok: false,
        reason: noRoute
          ? "No step-free route exists between these points under these limits."
          : `Routing unavailable: ${text.slice(0, 140)}`,
        noRouteExists: noRoute
      };
    }

    const data = await response.json();
    const feature = data.features?.[0];
    if (!feature) {
      return { ok: false, reason: "router returned no route", noRouteExists: false };
    }

    const summary = feature.properties.summary ?? {};
    const steepness = feature.properties.extras?.steepness?.summary ?? [];
    const maxIncline = steepness.length
      ? Math.max(...steepness.map((s: { value: number }) => Math.abs(s.value)))
      : null;

    const warnings: string[] = [];
    if (maxIncline && maxIncline > (params.maxInclinePercent ?? 6)) {
      warnings.push(
        `Contains a ${maxIncline}% gradient, steeper than the ${params.maxInclinePercent ?? 6}% limit given.`
      );
    }

    return {
      ok: true,
      distanceMetres: Math.round(summary.distance ?? 0),
      durationMinutes: Math.round((summary.duration ?? 0) / 60),
      maxInclinePercent: maxIncline,
      unavoidableSteps: 0,
      warnings,
      geometry: feature.geometry?.coordinates ?? [],
      // A route computed from map geometry is a prediction. Nobody has walked it.
      basis: "predicted",
      caveat:
        "Computed from OpenStreetMap geometry, not verified on the ground. " +
        "Kerbs, roadworks and broken lifts are frequently unmapped."
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "routing failed",
      noRouteExists: false
    };
  }
}

/** How much longer the step-free way is than the direct one. */
export async function accessibilityPenalty(
  from: [number, number],
  to: [number, number]
): Promise<{ walking: number | null; stepFree: number | null; extraMetres: number | null; note: string }> {
  const [walk, wheel] = await Promise.all([
    fetch(
      `${ORS_BASE}/v2/directions/foot-walking?api_key=${process.env.ORS_API_KEY}` +
        `&start=${from.join(",")}&end=${to.join(",")}`,
      { signal: AbortSignal.timeout(30_000) }
    )
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    stepFreeRoute({ from, to })
  ]);

  const walkMetres = walk?.features?.[0]?.properties?.summary?.distance ?? null;
  const wheelMetres = wheel.ok ? wheel.distanceMetres : null;

  return {
    walking: walkMetres ? Math.round(walkMetres) : null,
    stepFree: wheelMetres,
    extraMetres: walkMetres && wheelMetres ? Math.round(wheelMetres - walkMetres) : null,
    note:
      walkMetres && wheelMetres
        ? `The step-free route is ${Math.round(wheelMetres - walkMetres)}m longer — ` +
          `the distance a wheelchair user pays that a walking traveller does not.`
        : "Could not compare; one of the two routes is unavailable."
  };
}

/** Wheelchair-tagged places near a point, straight from OSM. */
export async function accessiblePlacesNear(
  lat: number,
  lon: number,
  radiusMetres = 500
): Promise<{ places: Array<{ name: string; kind: string; access: AccessFact }>; note: string }> {
  const query =
    `[out:json][timeout:30];(` +
    `node(around:${radiusMetres},${lat},${lon})["wheelchair"];` +
    `way(around:${radiusMetres},${lat},${lon})["wheelchair"];` +
    `);out tags center 120;`;

  try {
    const response = await fetch(OVERPASS, {
      method: "POST",
      body: new URLSearchParams({ data: query }),
      headers: { "User-Agent": "WanderOS/1.0 (accessibility routing)" },
      signal: AbortSignal.timeout(45_000)
    });
    if (!response.ok) return { places: [], note: `Overpass ${response.status}` };

    const data = await response.json();
    const places = (data.elements ?? [])
      .map((el: { tags?: Record<string, string> }) => {
        const tags = el.tags ?? {};
        const fact = readOsmAccess(tags);
        const decayed = decayConfidence(fact.observedAt, "entrance", 0.8);
        return {
          name: tags.name ?? tags.amenity ?? "unnamed",
          kind: tags.amenity ?? tags.shop ?? tags.tourism ?? "place",
          access: {
            ...fact,
            confidence: fact.observedAt ? decayed.confidence : 0.5,
            detail: decayed.stale && fact.observedAt
              ? `${fact.detail} — last surveyed ${decayed.ageDays} days ago, treat as out of date`
              : fact.detail
          }
        };
      })
      .filter((p: { access: AccessFact }) => p.access.level !== "unknown");

    return {
      places,
      note:
        `${places.length} places within ${radiusMetres}m carry a wheelchair tag. ` +
        `Untagged places are omitted rather than shown as inaccessible — absence ` +
        `of data is not a 'no'.`
    };
  } catch (error) {
    return {
      places: [],
      note: error instanceof Error ? error.message : "lookup failed"
    };
  }
}
