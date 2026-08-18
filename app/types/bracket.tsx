// Shape actually persisted on a bracket document's `items` array and passed
// around the realtime room state.
export interface BracketItem {
  id: string;
  title: string;
  url?: string;
  width?: number;
  height?: number;
  mediaType?: "image" | "video";
  duration?: number | null;
}
