export function buildPhotoDescriberPrompt(count: number) {
  return `You are describing travel photos for a memory book. For EACH image (index 0..${count - 1}, in order),
write ONE vivid sentence: what is in it, any place/landmark cues, the time of day, and the mood.
Be concrete and grounded in what you actually see — do not invent place names.
Return JSON: { descriptions: [{ index, description }] } with one entry per image, indexes 0..${count - 1}.`;
}
