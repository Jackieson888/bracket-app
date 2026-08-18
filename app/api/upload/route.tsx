import { v2 as cloudinary } from "cloudinary";
import { getCloudinaryConfig } from "@/lib/runtime-config";
import { checkRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

// quicktime covers the .mov files phones record by default.
const ALLOWED_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
]);

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

// Uploads are the most expensive endpoint here - each one streams to
// Cloudinary and burns transformation quota.
const UPLOAD_LIMIT = 20;
const UPLOAD_WINDOW_MS = 60_000;

export async function POST(req: Request) {
  try {
    const limit = checkRateLimit(
      clientKey(req, "upload"),
      UPLOAD_LIMIT,
      UPLOAD_WINDOW_MS,
    );
    if (!limit.ok) {
      return rateLimitResponse(limit.retryAfterSeconds);
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    const isImage = ALLOWED_IMAGE_MIME_TYPES.has(file.type);
    const isVideo = ALLOWED_VIDEO_MIME_TYPES.has(file.type);

    if (!isImage && !isVideo) {
      return Response.json(
        {
          error:
            "Only JPEG, PNG, GIF, WebP images and MP4, MOV, WebM videos are allowed",
        },
        { status: 400 },
      );
    }

    const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

    if (file.size > maxBytes) {
      return Response.json(
        {
          error: isVideo
            ? "Video must be smaller than 40MB"
            : "Image must be smaller than 8MB",
        },
        { status: 400 },
      );
    }

    const cloudinaryConfig = getCloudinaryConfig();

    if (!cloudinaryConfig) {
      return Response.json(
        { error: "Cloudinary is not configured for this environment" },
        { status: 500 },
      );
    }

    cloudinary.config(cloudinaryConfig);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "bracket-items",
            // Filing videos under Cloudinary's video resource type is what
            // makes the mp4 rendition and poster-frame transforms available.
            resource_type: isVideo ? "video" : "image",
          },
          (error, uploadResult) => {
            if (error) reject(error);
            else resolve(uploadResult as unknown as Record<string, unknown>);
          },
        );
        stream.end(buffer);
      },
    );

    return Response.json({
      url: result.secure_url,
      width: result.width,
      height: result.height,
      mediaType: isVideo ? "video" : "image",
      duration: typeof result.duration === "number" ? result.duration : null,
    });
  } catch (err) {
    // A truncated multipart body fails here rather than at any size check:
    // when proxy.ts is in play Next buffers the body up to
    // experimental.proxyClientMaxBodySize and silently passes on the partial
    // request, so formData() sees multipart data with no closing boundary.
    if (err instanceof TypeError && /FormData/i.test(err.message)) {
      console.error("Upload error: could not parse the request body", err);
      return Response.json(
        {
          error:
            "The file was too large to reach the server. Try a shorter clip.",
        },
        { status: 413 },
      );
    }

    console.error("Upload error:", err);
    return Response.json({ error: "Upload failed" }, { status: 500 });
  }
}
