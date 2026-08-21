export type MediaType = "image" | "video" | "audio";

export type MediaItem = {
  url?: string | null;
  mediaType?: string | null;
  posterUrl?: string | null;
};

const VIDEO_EXTENSION = /\.(mp4|webm|ogv|mov|m4v|avi|mkv|qt)(\?.*)?$/i;
const AUDIO_EXTENSION = /\.(mp3|wav|aac|m4a|oga|flac)(\?.*)?$/i;

const CLOUDINARY_VIDEO_MARKER = "/video/upload/";
const CLOUDINARY_IMAGE_MARKER = "/image/upload/";

// Longest a single contender clip is allowed to hold the intro overlay before
// the sequence moves on by itself. Clips shorter than this advance on `ended`.
// Every connected player now has to vote for a match to resolve, so a long
// intro no longer risks the match being decided while someone is still
// watching it.
export const MAX_INTRO_CLIP_MS = 30000;

function stripQuery(url: string): string {
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

// Cloudinary delivery URLs look like
// https://res.cloudinary.com/<cloud>/video/upload/<transforms>/v123/folder/id.mov
// so the resource kind is in the path, not the extension. Fall back to the
// extension for anything hosted elsewhere.
export function resolveMediaType(item: MediaItem | null | undefined): MediaType {
  if (!item) {
    return "image";
  }

  const declared = item.mediaType?.toLowerCase();
  if (declared === "video" || declared === "audio" || declared === "image") {
    return declared;
  }

  const url = item.url;
  if (!url) {
    return "image";
  }

  if (url.includes(CLOUDINARY_VIDEO_MARKER)) {
    // Cloudinary serves audio uploads from the video resource type too, so an
    // audio extension under /video/upload/ is still audio.
    return AUDIO_EXTENSION.test(stripQuery(url)) ? "audio" : "video";
  }

  if (url.includes(CLOUDINARY_IMAGE_MARKER)) {
    return "image";
  }

  if (VIDEO_EXTENSION.test(stripQuery(url))) {
    return "video";
  }

  if (AUDIO_EXTENSION.test(stripQuery(url))) {
    return "audio";
  }

  return "image";
}

export function isVideoItem(item: MediaItem | null | undefined): boolean {
  return resolveMediaType(item) === "video";
}

function insertCloudinaryTransform(
  url: string,
  marker: string,
  transform: string,
): string | null {
  const markerIndex = url.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const insertAt = markerIndex + marker.length;
  return `${url.slice(0, insertAt)}${transform}/${url.slice(insertAt)}`;
}

function replaceExtension(url: string, extension: string): string {
  const queryIndex = url.indexOf("?");
  const path = queryIndex === -1 ? url : url.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : url.slice(queryIndex);
  const lastDot = path.lastIndexOf(".");
  const lastSlash = path.lastIndexOf("/");

  if (lastDot === -1 || lastDot < lastSlash) {
    return `${path}.${extension}${query}`;
  }

  return `${path.slice(0, lastDot)}.${extension}${query}`;
}

// Uploaded .mov files play in Safari but not reliably in Chrome/Firefox, so we
// always ask Cloudinary for an mp4 rendition rather than the stored original.
export function videoSourceUrl(
  url: string | null | undefined,
  { maxWidth = 720 }: { maxWidth?: number } = {},
): string | null {
  if (!url) {
    return null;
  }

  const transformed = insertCloudinaryTransform(
    url,
    CLOUDINARY_VIDEO_MARKER,
    `c_limit,w_${maxWidth},q_auto`,
  );

  if (!transformed) {
    return url;
  }

  return replaceExtension(transformed, "mp4");
}

// First frame of the clip as a still, used for `poster` and for the board card.
export function videoPosterUrl(
  item: MediaItem | null | undefined,
  { maxWidth = 720 }: { maxWidth?: number } = {},
): string | null {
  if (!item) {
    return null;
  }

  if (item.posterUrl) {
    return item.posterUrl;
  }

  if (!item.url) {
    return null;
  }

  // e_trim drops a uniform border, which for a clip letterboxed into 16:9
  // means the baked-in black bars: the card crops to fill, so without this the
  // bars survive as dead bands across the top and bottom of the still. A frame
  // that has no border to trim comes back untouched.
  const transformed = insertCloudinaryTransform(
    item.url,
    CLOUDINARY_VIDEO_MARKER,
    `so_0,e_trim,c_limit,w_${maxWidth},q_auto`,
  );

  if (!transformed) {
    return null;
  }

  return replaceExtension(transformed, "jpg");
}

// A single still URL suitable for <Image>, whatever the underlying media is.
export function previewImageUrl(
  item: MediaItem | null | undefined,
): string | null {
  if (!item?.url) {
    return null;
  }

  if (resolveMediaType(item) === "video") {
    return videoPosterUrl(item);
  }

  return item.url;
}
