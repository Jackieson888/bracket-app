export async function createSessionAndNavigate(item: unknown): Promise<void> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  const data = await res.json();
  if (!data?.slug) {
    throw new Error("Session could not be created");
  }

  // Proof that this tab is the one that made the room. The room page
  // presents it when joining, which is what makes the creator the host
  // instead of whoever's socket happens to verify first.
  if (data.hostClaimToken) {
    try {
      window.sessionStorage.setItem(
        `tvt-host-claim:${data.slug}`,
        data.hostClaimToken,
      );
    } catch {
      // Storage is unavailable - the room still opens, the host role just
      // falls back to first-to-verify.
    }
  }

  window.location.href = `/play/${data.slug}`;
}
