function generateSlug() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let slug = "";
  for (let i = 0; i < 5; i++) {
    slug += letters[Math.floor(Math.random() * letters.length)];
  }
  return slug;
}

export default generateSlug;
