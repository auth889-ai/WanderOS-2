/**
 * Listing lifecycle state machine (pure, no I/O). The service enforces these transitions so a listing
 * can only move through valid states:  draft → editing → pending_review → approved → published → archived/deleted.
 */
export type ListingStatus =
  | "draft"
  | "editing"
  | "pending_review"
  | "approved"
  | "published"
  | "archived"
  | "deleted";

/** Allowed next states from each state. */
const TRANSITIONS: Record<ListingStatus, ListingStatus[]> = {
  draft: ["editing", "pending_review", "archived", "deleted"],
  editing: ["draft", "pending_review", "archived", "deleted"],
  pending_review: ["draft", "approved", "archived", "deleted"], // host can pull it back; admin approves
  approved: ["published", "pending_review", "archived"],
  published: ["pending_review", "archived"], // re-edit forces re-review
  archived: ["draft", "deleted"], // can be restored to draft
  deleted: [] // terminal
};

export function canTransition(from: string, to: ListingStatus): boolean {
  return (TRANSITIONS[from as ListingStatus] ?? []).includes(to);
}

/** States in which the host may still edit the content. */
export function isEditable(status: string): boolean {
  return ["draft", "editing", "pending_review"].includes(status);
}
