// The bug the API-level scenarios structurally cannot see: the browser client
// registering itself twice at once.
//
// Opening a room fires one join from the socket's "open" handler; touching the
// display name fires another. Run in parallel both post a null participant
// token, the first mints one, and the join endpoint correctly refuses the
// second as a takeover of a slot that now has a credential. Whichever call
// loses, a real player pays for it:
//
//   - the socket never sends "auth", so the server drops its votes, leaves it
//     out of the quorum (one friend's vote then settles every match alone),
//     and hands the host role to whoever authenticated first;
//   - or the display name never persists and the player stays "Guest".
//
// Both of those were reported from a two-player game. This drives the real
// client and asserts the handshake comes out clean.
import {
  createSession,
  loadChromium,
  makeItems,
  scenario,
  sleep,
} from "../lib/harness.mjs";

scenario(
  "browser-join-handshake",
  {
    covers:
      "Opening a room and setting a display name at the same moment still leaves the player verified, named, and hosting",
  },
  async (t) => {
    const chromium = await loadChromium();
    if (!chromium) {
      t.skip("browser-join-handshake", "playwright is not installed");
      return;
    }

    const items = makeItems(4, "handshake");
    const slug = await createSession({ title: `QA Handshake ${Date.now()}`, items });
    t.trackSession(slug);

    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: 430, height: 932 },
        hasTouch: true,
      });
      const page = await context.newPage();

      const joinResponses = [];
      const authFrames = [];
      page.on("response", (response) => {
        if (
          response.request().method() === "POST" &&
          response.url().includes(`/api/sessions/${slug}`)
        ) {
          joinResponses.push(response.status());
        }
      });
      page.on("websocket", (ws) => {
        if (ws.url().includes("webpack")) return;
        ws.on("framesent", (frame) => {
          const payload = String(frame.payload);
          if (payload.includes('"auth"')) authFrames.push("sent");
        });
        ws.on("framereceived", (frame) => {
          const payload = String(frame.payload);
          if (payload.includes("auth-ok")) authFrames.push("ok");
          if (payload.includes("auth-denied")) authFrames.push("denied");
        });
      });

      // The collision is a timing window, and on a warm server it is only a
      // few milliseconds wide - too narrow to hit reliably by clicking fast.
      // Holding the first join open widens it to something a test can aim at:
      // any client that registers twice in parallel now has both requests in
      // flight at once, which is exactly the state that produced the 403.
      let joinsSeen = 0;
      await page.route(`**/api/sessions/${slug}`, async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        joinsSeen += 1;
        if (joinsSeen === 1) {
          await sleep(1500);
        }
        await route.continue();
      });

      await page.goto(`${t.baseUrl}/play/${slug}`, {
        waitUntil: "domcontentloaded",
      });

      // Name it the instant the field exists - that is the collision window.
      const nameBox = page.getByRole("textbox", { name: "Display name" });
      await nameBox.waitFor({ timeout: 30000 });
      await nameBox.fill("Handshake");
      await page.getByRole("button", { name: "Update display name" }).click();
      await sleep(6000);

      t.metric("joinResponses", joinResponses);
      t.metric("authFrames", authFrames);

      t.check(
        "no-join-is-refused-as-a-takeover",
        joinResponses.length > 0 && joinResponses.every((status) => status === 200),
        `join statuses=${JSON.stringify(joinResponses)}`,
      );
      t.check(
        "socket-ends-up-verified",
        authFrames.includes("ok") && !authFrames.includes("denied"),
        `auth frames=${JSON.stringify(authFrames)}`,
      );

      // Verified is what earns the host role and a place in the quorum, so
      // read it back off the room the way another player's client would.
      const snapshot = await fetch(`${t.baseUrl}/api/sessions/${slug}`, {
        headers: { "x-forwarded-for": "10.98.0.7" },
      }).then((res) => res.json());
      const names = Object.values(snapshot.participantLookup ?? {}).map(
        (entry) => entry.displayName,
      );

      t.check(
        "display-name-survives-the-race",
        names.includes("Handshake"),
        `names=${JSON.stringify(names)}`,
      );
      t.check(
        "only-one-player-slot-is-used",
        names.length === 1,
        `names=${JSON.stringify(names)}`,
      );

      // The host is the first socket to authenticate, so an unverified client
      // silently loses the role - and with it the START GAME button.
      const startVisible = await page
        .getByText("START GAME")
        .isVisible()
        .catch(() => false);
      t.check(
        "verified-player-is-offered-the-start",
        startVisible,
        `host=${snapshot.hostParticipantId} startVisible=${startVisible}`,
      );
    } finally {
      await browser.close();
    }
  },
);
