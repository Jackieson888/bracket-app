import assert from "node:assert/strict";
import test from "node:test";

import { getCloudinaryConfig, getRequiredEnvVar } from "./runtime-config";

test("returns a required environment variable when configured", () => {
  process.env.MONGODB_URI = "mongodb://localhost:27017";

  assert.equal(getRequiredEnvVar("MONGODB_URI"), "mongodb://localhost:27017");
});

test("returns Cloudinary config only when all values are present", () => {
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "12345";
  process.env.CLOUDINARY_API_SECRET = "secret";

  assert.deepEqual(getCloudinaryConfig(), {
    cloud_name: "demo",
    api_key: "12345",
    api_secret: "secret",
  });
});

test("throws a descriptive error when a required env var is missing", () => {
  delete process.env.MONGODB_URI;

  assert.throws(
    () => getRequiredEnvVar("MONGODB_URI"),
    /Missing required environment variable: MONGODB_URI/,
  );
});
