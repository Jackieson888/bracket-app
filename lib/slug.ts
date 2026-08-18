import { randomInt } from "crypto";

// Ambiguous glyphs are left out: these codes get read aloud and typed by hand
// in a room full of people, so O/0 and I/1 cost more than the entropy they add.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SLUG_LENGTH = 5;

// randomInt is drawn from the CSPRNG and is free of the modulo bias a
// Math.random() index introduces. Room codes are join credentials for an
// unlisted game, so they should not be predictable from prior codes.
function generateSlug() {
  let slug = "";
  for (let i = 0; i < SLUG_LENGTH; i++) {
    slug += ALPHABET[randomInt(ALPHABET.length)];
  }
  return slug;
}

export default generateSlug;
