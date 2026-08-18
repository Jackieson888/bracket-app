import assert from "node:assert/strict";
import test from "node:test";

import {
  isVideoItem,
  previewImageUrl,
  resolveMediaType,
  videoPosterUrl,
  videoSourceUrl,
} from "./media";
import { buildShareCardUrl } from "./share-card";

const VIDEO_URL =
  "https://res.cloudinary.com/demo/video/upload/v1700000000/bracket-items/clip.mov";
const IMAGE_URL =
  "https://res.cloudinary.com/demo/image/upload/v1700000000/bracket-items/pic.jpg";

test("resolves media type from an explicit mediaType field", () => {
  assert.equal(resolveMediaType({ url: IMAGE_URL, mediaType: "video" }), "video");
  assert.equal(resolveMediaType({ url: VIDEO_URL, mediaType: "image" }), "image");
});

test("infers video from the Cloudinary resource path, not the extension", () => {
  // .mov would not match a naive mp4|webm|ogg extension test.
  assert.equal(resolveMediaType({ url: VIDEO_URL }), "video");
  assert.equal(resolveMediaType({ url: IMAGE_URL }), "image");
  assert.equal(isVideoItem({ url: VIDEO_URL }), true);
});

test("treats audio delivered from the video resource type as audio", () => {
  const audioUrl =
    "https://res.cloudinary.com/demo/video/upload/v1/bracket-items/sound.mp3";
  assert.equal(resolveMediaType({ url: audioUrl }), "audio");
});

test("defaults legacy items with no media hints to image", () => {
  assert.equal(resolveMediaType({ url: "https://example.com/thing" }), "image");
  assert.equal(resolveMediaType(null), "image");
  assert.equal(resolveMediaType({}), "image");
});

test("rewrites a .mov source to an mp4 rendition browsers can play", () => {
  const src = videoSourceUrl(VIDEO_URL);
  assert.equal(
    src,
    "https://res.cloudinary.com/demo/video/upload/c_limit,w_720,q_auto/v1700000000/bracket-items/clip.mp4",
  );
});

test("builds a jpg poster frame from the first frame of the clip", () => {
  const poster = videoPosterUrl({ url: VIDEO_URL });
  assert.equal(
    poster,
    "https://res.cloudinary.com/demo/video/upload/so_0,c_limit,w_720,q_auto/v1700000000/bracket-items/clip.jpg",
  );
});

test("prefers a stored posterUrl over deriving one", () => {
  const poster = videoPosterUrl({ url: VIDEO_URL, posterUrl: IMAGE_URL });
  assert.equal(poster, IMAGE_URL);
});

test("previewImageUrl returns the image itself but a poster for video", () => {
  assert.equal(previewImageUrl({ url: IMAGE_URL }), IMAGE_URL);
  assert.match(previewImageUrl({ url: VIDEO_URL }) ?? "", /so_0.*\.jpg$/);
  assert.equal(previewImageUrl({}), null);
});

test("leaves non-Cloudinary video urls untouched as a source", () => {
  const src = videoSourceUrl("https://example.com/clip.mp4");
  assert.equal(src, "https://example.com/clip.mp4");
  assert.equal(videoPosterUrl({ url: "https://example.com/clip.mp4" }), null);
});

test("share card grabs a frame before overlaying text on a video winner", () => {
  const url = buildShareCardUrl({ imageUrl: VIDEO_URL, title: "Nude Egg" });
  assert.ok(url);
  // so_0 must chain ahead of the overlay, and delivery must be a still.
  assert.ok(url.indexOf("/so_0/") < url.indexOf("l_text:"));
  assert.ok(url.endsWith(".jpg"));
});

test("share card still works unchanged for image winners", () => {
  const url = buildShareCardUrl({ imageUrl: IMAGE_URL, title: "What The Hell" });
  assert.ok(url);
  assert.ok(url.includes("/image/upload/l_text:"));
  assert.ok(!url.includes("so_0"));
});
