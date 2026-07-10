import { invokeStructured } from "@/lib/ai/structured";
import { retrieve } from "@/lib/agents/tools/pgvector-retriever.tool";
import { listApprovedByIds, listApprovedForDestination, ListingRow } from "@/lib/db/tables/listings";
import { StayRecommendation } from "../../schemas";
import { buildStayMatcherPrompt } from "./prompt";
import {
  StayCandidate,
  StayMatcherInput,
  StayMatcherInputSchema,
  StayMatcherResult,
  StayMatcherResultSchema,
  StayRankerOutputSchema
} from "./schema";

type CandidateWithListing = StayCandidate & { listing: ListingRow };

function normalize(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function tripNights(input: StayMatcherInput) {
  if (!input.brief.startDate || !input.brief.endDate) return 1;
  const start = new Date(input.brief.startDate);
  const end = new Date(input.brief.endDate);
  const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return Number.isFinite(nights) && nights > 0 ? nights : 1;
}

function destinationMatches(listing: ListingRow, destination: string) {
  const dest = normalize(destination);
  const city = normalize(listing.city);
  const country = normalize(listing.country);
  return Boolean(city && (dest === city || dest.includes(city) || city.includes(dest))) || Boolean(country && dest.includes(country));
}

function maxNightlyBudget(input: StayMatcherInput) {
  const budget = input.profile.budget ?? input.brief.budget;
  if (!budget || budget <= 0) return null;
  return (budget * 0.62) / tripNights(input);
}

function textFitScore(listing: ListingRow, input: StayMatcherInput) {
  const text = normalize(
    [
      listing.title,
      listing.description,
      listing.category,
      ...(listing.tags || []),
      ...(listing.amenities || []),
      input.destinationIntel?.themes.join(" ") || ""
    ].join(" ")
  );
  const needles = unique([
    ...(input.profile.interests || []),
    input.profile.travelStyle || "",
    input.brief.travelStyle || "",
    input.profile.party || ""
  ].map(normalize).filter(Boolean));
  if (!needles.length) return 0.08;
  const matched = needles.filter((needle) => text.includes(needle) || needle.split(/\W+/).some((part) => part.length > 3 && text.includes(part)));
  return Math.min(0.22, matched.length * 0.055);
}

function scoreListing(listing: ListingRow, input: StayMatcherInput, similarity: number, source: "pgvector" | "aurora") {
  let score = source === "pgvector" ? Math.min(0.42, Math.max(0, similarity) * 0.42) : 0.16;
  if (destinationMatches(listing, input.brief.destination)) score += 0.22;

  const travelerCount = input.profile.travelerCount;
  if (!travelerCount || !listing.max_guests || listing.max_guests >= travelerCount) score += 0.14;

  const price = Number(listing.price || 0);
  const nightlyBudget = maxNightlyBudget(input);
  if (!nightlyBudget || price <= nightlyBudget) score += 0.14;
  else if (price <= nightlyBudget * 1.35) score += 0.07;

  if (listing.quality_score) score += Math.min(0.08, Number(listing.quality_score) / 1250);
  score += textFitScore(listing, input);

  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

function makeWhy(candidate: CandidateWithListing, input: StayMatcherInput) {
  const party = input.profile.party || "trip";
  const style = input.profile.travelStyle || input.brief.travelStyle || "travel style";
  return `${candidate.title} fits this ${party} ${style} plan in ${candidate.city} with ${candidate.category} stay context and a nightly price of ${candidate.pricePerNight}.`;
}

function toRecommendation(candidate: CandidateWithListing, matchScore: number, why: string): StayRecommendation {
  return {
    listingId: candidate.listingId,
    title: candidate.title,
    area: candidate.city,
    pricePerNight: candidate.pricePerNight,
    currency: "USD",
    maxGuests: candidate.maxGuests || undefined,
    matchScore: Math.max(0, Math.min(1, Number(matchScore.toFixed(3)))),
    why,
    source: candidate.source,
    hardFiltersPassed: true
  };
}

function deterministicRecommendations(candidates: CandidateWithListing[], input: StayMatcherInput): StayRecommendation[] {
  return candidates.slice(0, 3).map((candidate) => toRecommendation(candidate, candidate.deterministicScore, makeWhy(candidate, input)));
}

function passesHardFilters(listing: ListingRow, input: StayMatcherInput) {
  if (!destinationMatches(listing, input.brief.destination)) return false;
  const travelerCount = input.profile.travelerCount;
  if (travelerCount && listing.max_guests && listing.max_guests < travelerCount) return false;

  const price = Number(listing.price || 0);
  const nightlyBudget = maxNightlyBudget(input);
  if (nightlyBudget && price > nightlyBudget * 1.75 && input.profile.budgetBand !== "luxury") return false;

  return true;
}

function toCandidate(
  listing: ListingRow,
  input: StayMatcherInput,
  similarity: number,
  source: "pgvector" | "aurora"
): CandidateWithListing {
  const candidate: CandidateWithListing = {
    listingId: listing.id,
    title: listing.title,
    city: listing.city,
    country: listing.country,
    category: listing.category,
    pricePerNight: Number(listing.price || 0),
    maxGuests: listing.max_guests,
    tags: listing.tags || [],
    amenities: listing.amenities || [],
    similarity,
    deterministicScore: scoreListing(listing, input, similarity, source),
    source,
    listing
  };
  return candidate;
}

/**
 * stay-matcher agent - grounded RAG over approved WanderOS listings.
 * pgvector retrieves candidates; Aurora hard filters and deterministic ranking protect product truth.
 */
export async function matchStays(input: unknown): Promise<StayMatcherResult> {
  const parsed = StayMatcherInputSchema.parse(input);
  const warnings: string[] = [];
  const query = parsed.profile.query;

  const hits = await retrieve({ query, ownerTypes: ["listing"], limit: 12 });
  const sourceIds = hits.map((hit) => hit.id);
  const hitByOwnerId = new Map(hits.map((hit) => [hit.owner_id, hit]));
  const approvedFromRag = await listApprovedByIds(hits.map((hit) => hit.owner_id));

  let listings = approvedFromRag;
  const sourceByListingId = new Map<string, "pgvector" | "aurora">(approvedFromRag.map((listing) => [listing.id, "pgvector"]));

  if (listings.length < 3) {
    const auroraFallback = await listApprovedForDestination(parsed.brief.destination, 8);
    const existing = new Set(listings.map((listing) => listing.id));
    const additions = auroraFallback.filter((listing) => !existing.has(listing.id));
    if (additions.length) {
      warnings.push("Listing embeddings were sparse; included approved Aurora destination listings.");
      listings = [...listings, ...additions];
      for (const listing of additions) sourceByListingId.set(listing.id, "aurora");
    }
  }

  const candidates = listings
    .filter((listing) => passesHardFilters(listing, parsed))
    .map((listing) => {
      const source = sourceByListingId.get(listing.id) || "aurora";
      const similarity = source === "pgvector" ? Number(hitByOwnerId.get(listing.id)?.similarity || 0) : 0;
      return toCandidate(listing, parsed, similarity, source);
    })
    .sort((a, b) => b.deterministicScore - a.deterministicScore)
    .slice(0, 8);

  if (!candidates.length) {
    return StayMatcherResultSchema.parse({
      recommendations: [],
      retrieval: {
        query,
        retrievedCount: hits.length,
        candidateCount: 0,
        sourceIds,
        warnings: [...warnings, "No approved destination listing passed stay-matcher hard filters."]
      },
      reasoning: "No real approved WanderOS stay matched the destination, party, and budget filters."
    });
  }

  let recommendations = deterministicRecommendations(candidates, parsed);
  let reasoning = "Deterministic ranking selected the strongest approved WanderOS stays.";

  try {
    const ranked = await invokeStructured(StayRankerOutputSchema, buildStayMatcherPrompt(parsed, candidates), { tier: "flash", retries: 1 });
    const candidateById = new Map(candidates.map((candidate) => [candidate.listingId, candidate]));
    const seen = new Set<string>();
    const modelRecommendations = ranked.picks
      .filter((pick) => candidateById.has(pick.listingId) && !seen.has(pick.listingId) && seen.add(pick.listingId))
      .map((pick) => {
        const candidate = candidateById.get(pick.listingId) as CandidateWithListing;
        return toRecommendation(candidate, pick.matchScore, pick.why || makeWhy(candidate, parsed));
      });

    if (modelRecommendations.length) {
      recommendations = modelRecommendations;
      reasoning = ranked.reasoning || "Flash ranker selected the strongest approved WanderOS stays.";
    } else {
      warnings.push("Stay ranker returned no valid candidate ids; used deterministic ranking.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Stay ranker unavailable; used deterministic ranking. ${message.slice(0, 120)}`);
  }

  return StayMatcherResultSchema.parse({
    recommendations,
    retrieval: {
      query,
      retrievedCount: hits.length,
      candidateCount: candidates.length,
      sourceIds,
      warnings
    },
    reasoning
  });
}
