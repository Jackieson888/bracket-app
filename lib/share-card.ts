const MAX_SHARE_TEXT_LENGTH = 60;
const UPLOAD_MARKER = "/image/upload/";
const VIDEO_UPLOAD_MARKER = "/video/upload/";
// Grabs the first frame so a video contender still produces a still card.
const VIDEO_FRAME_TRANSFORM = "so_0";
const PLACEHOLDER_PUBLIC_ID = "tvt/share-card-placeholder";
const TEXT_OVERLAY_STYLE = "l_text:Poppins_60_bold";
const TEXT_OVERLAY_PLACEMENT = "co_white,g_south,y_60,c_fit,w_1000";

// Strips characters/whitespace that would otherwise need escaping in a
// Cloudinary l_text overlay and caps length so it never overflows the card.
export function sanitizeShareText(title: string): string {
  return title
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, MAX_SHARE_TEXT_LENGTH);
}

function insertTransformation(url: string, transformation: string): string | null {
  const markerIndex = url.indexOf(UPLOAD_MARKER);
  if (markerIndex === -1) {
    return null;
  }

  const insertAt = markerIndex + UPLOAD_MARKER.length;
  return `${url.slice(0, insertAt)}${transformation}/${url.slice(insertAt)}`;
}

function toJpgExtension(url: string): string {
  const queryIndex = url.indexOf("?");
  const path = queryIndex === -1 ? url : url.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : url.slice(queryIndex);
  const lastDot = path.lastIndexOf(".");
  const lastSlash = path.lastIndexOf("/");

  if (lastDot === -1 || lastDot < lastSlash) {
    return `${path}.jpg${query}`;
  }

  return `${path.slice(0, lastDot)}.jpg${query}`;
}

// Video assets live under /video/upload/, so the frame grab has to be chained
// ahead of the text overlay and the delivery extension swapped to a still.
function insertVideoTransformation(
  url: string,
  transformation: string,
): string | null {
  const markerIndex = url.indexOf(VIDEO_UPLOAD_MARKER);
  if (markerIndex === -1) {
    return null;
  }

  const insertAt = markerIndex + VIDEO_UPLOAD_MARKER.length;
  const withOverlay = `${url.slice(0, insertAt)}${VIDEO_FRAME_TRANSFORM}/${transformation}/${url.slice(insertAt)}`;
  return toJpgExtension(withOverlay);
}

export function buildShareCardUrl({
  imageUrl,
  title,
  cloudName,
}: {
  imageUrl?: string | null;
  title: string;
  cloudName?: string | null;
}): string | null {
  const safeText = sanitizeShareText(title);
  if (!safeText) {
    return null;
  }

  const transformation = `${TEXT_OVERLAY_STYLE}:${encodeURIComponent(safeText)},${TEXT_OVERLAY_PLACEMENT}`;

  if (imageUrl) {
    if (imageUrl.includes(VIDEO_UPLOAD_MARKER)) {
      return insertVideoTransformation(imageUrl, transformation);
    }

    return insertTransformation(imageUrl, transformation);
  }

  // Text-only winner (no uploaded image) — fall back to a placeholder base
  // asset. Requires a one-time manual upload of an image at this public id
  // to the Cloudinary account (see plan doc for size/style guidance).
  if (!cloudName) {
    return null;
  }

  return `https://res.cloudinary.com/${cloudName}${UPLOAD_MARKER}${transformation}/${PLACEHOLDER_PUBLIC_ID}`;
}
