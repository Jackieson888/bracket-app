export const SWATCHES = [
  "var(--primary)",
  "var(--secondary)",
  "var(--tertiary)",
  "var(--accent)",
];

export function swatchForIndex(index: number) {
  return SWATCHES[index % SWATCHES.length];
}

// Returns null when there is no real name to abbreviate, so callers can show
// a generic account icon instead of inventing initials for an anonymous
// player. (This used to return the literal "GU", which read as a person whose
// name began with those letters.)
export function initialsFor(name: string | null | undefined): string | null {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return null;
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}
