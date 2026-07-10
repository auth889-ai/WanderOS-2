export type TripBriefPayload = {
  title?: string;
  destination: string;
  startDate?: string;
  endDate?: string;
  budget?: number;
  travelStyle?: string;
  interests?: string[];
  party?: string;
  pace?: string;
  constraints?: Record<string, unknown>;
};

async function jsonRequest<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Trip request failed.");
  }
  return payload as T;
}

export function createTripPlan(payload: TripBriefPayload) {
  return jsonRequest<{ tripId: string; jobId: string; status: string }>("/api/trips", payload);
}

export function regenerateTripPlan(tripId: string, hint: string) {
  return jsonRequest<{ tripId: string; jobId: string; status: string }>(`/api/trips/${tripId}/regenerate`, { hint });
}

export function refineTripPlan(tripId: string, instruction: string) {
  return jsonRequest<{ tripId: string; jobId: string; status: string }>(`/api/trips/${tripId}/refine`, { instruction });
}

export function addTripItem(tripId: string, payload: {
  dayNumber: number;
  timeLabel?: string | null;
  title: string;
  description?: string | null;
  category?: string | null;
  estCost?: number;
  locked?: boolean;
}) {
  return jsonRequest<{ item: unknown }>(`/api/trips/${tripId}/items`, payload);
}

export async function updateTripItem(tripId: string, itemId: string, payload: {
  dayNumber?: number;
  timeLabel?: string | null;
  title?: string;
  description?: string | null;
  category?: string | null;
  estCost?: number;
  locked?: boolean;
}) {
  const response = await fetch(`/api/trips/${tripId}/items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Trip item update failed.");
  return body as { item: unknown };
}

export async function deleteTripItem(tripId: string, itemId: string) {
  const response = await fetch(`/api/trips/${tripId}/items/${itemId}`, { method: "DELETE" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Trip item delete failed.");
  return body as { item: unknown };
}

export const tripStreamUrl = (tripId: string) => `/api/trips/${tripId}/stream`;
