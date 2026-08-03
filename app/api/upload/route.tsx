import { v2 as cloudinary } from "cloudinary";
import { getCloudinaryConfig } from "@/lib/runtime-config";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return Response.json(
        { error: "Only JPEG, PNG, GIF, and WebP images are allowed" },
        { status: 400 },
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json(
        { error: "Image must be smaller than 8MB" },
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

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "bracket-items" },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        },
      );
      stream.end(buffer);
    });

    return Response.json({
      url: (result as any).secure_url,
      width: (result as any).width,
      height: (result as any).height,
    });
  } catch (err) {
    console.error("Upload error:", err);
    return Response.json({ error: "Upload failed" }, { status: 500 });
  }
}
