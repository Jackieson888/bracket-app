// The one thing the API-level scenarios can never catch: the board rendering.
// A still that loads perfectly and then paints into a zero-width box looks
// exactly like a working app from the server's side.
//
// Needs Playwright and a bracket with real media; skips itself politely
// without either.
import { createSession, loadChromium, scenario, sleep } from "../lib/harness.mjs";

scenario(
  "board-visuals",
  {
    covers:
      "The matchup board actually paints: stills fill their cards, titles read over them, the countdown stays hidden until the end",
  },
  async (t) => {
    const chromium = await loadChromium();
    if (!chromium) {
      t.skip("board-visuals", "playwright is not installed");
      return;
    }
    if (!t.mongo) {
      t.skip("board-visuals", "needs Mongo to find a bracket with media");
      return;
    }

    const source = await t.mongo
      .db("prod")
      .collection("brackets")
      .findOne({ "items.url": { $exists: true } });

    if (!source) {
      t.skip("board-visuals", "no bracket with media to render");
      return;
    }

    const items = source.items.filter((item) => item.url).slice(0, 4);
    if (items.length < 2) {
      t.skip("board-visuals", "bracket does not have two items with media");
      return;
    }

    const slug = await createSession({
      _id: String(source._id),
      title: `QA Visuals ${Date.now()}`,
      items,
    });
    t.trackSession(slug);

    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: 430, height: 932 },
        hasTouch: true,
      });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });

      await page.goto(`${t.baseUrl}/play/${slug}`, {
        waitUntil: "domcontentloaded",
      });
      await page
        .getByRole("textbox", { name: "Display name" })
        .waitFor({ timeout: 30000 });

      await page.getByText("START GAME").click({ timeout: 30000 });

      // The board renders once before the intro effect hides it, so waiting on
      // the panel alone catches that first frame and finds an empty board a
      // moment later. Wait for the intro to finish, then for the cards.
      await page
        .locator(".bracket-intro-overlay")
        .waitFor({ state: "detached", timeout: 90000 })
        .catch(() => {});
      await page
        .locator(".bracket-item-media")
        .nth(1)
        .waitFor({ timeout: 30000 });
      await sleep(800);

      const media = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".bracket-item-media")).map(
          (node) => {
            const image = node.querySelector("img");
            const box = node.getBoundingClientRect();
            return {
              width: Math.round(box.width),
              height: Math.round(box.height),
              hasImage: Boolean(image),
              loaded: Boolean(image?.complete && image.naturalWidth > 0),
              painted: image
                ? Math.round(image.getBoundingClientRect().width)
                : 0,
            };
          },
        ),
      );

      t.metric("media", media);

      t.check(
        "both-contenders-render-a-card",
        media.length === 2,
        `found ${media.length} media boxes`,
      );
      // Guarded on length: `every` over an empty list is true, so without this
      // an empty board would report a clean sweep.
      t.check(
        "stills-load",
        media.length === 2 && media.every((entry) => entry.hasImage && entry.loaded),
        JSON.stringify(media),
      );
      // The regression this exists for: ButtonBase centres its children, and a
      // box whose only child is an absolutely positioned <Image fill> has no
      // content to be measured from, so it collapsed to zero width.
      t.check(
        "stills-have-somewhere-to-paint",
        media.length === 2 &&
          media.every((entry) => entry.width > 200 && entry.painted > 200),
        JSON.stringify(media),
      );
      t.check(
        "stills-fill-the-card",
        media.length === 2 && media.every((entry) => entry.height > 120),
        JSON.stringify(media),
      );

      const captions = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".bracket-item-title")).map(
          (node) => node.textContent?.trim() ?? "",
        ),
      );
      t.check(
        "titles-render-over-the-stills",
        captions.length === 2 && captions.every(Boolean),
        JSON.stringify(captions),
      );

      const timerAtStart = await page.locator(".bracket-timer").count();
      t.check(
        "countdown-hidden-while-there-is-time",
        timerAtStart === 0,
        `timer elements at start: ${timerAtStart}`,
      );

      // Voting alone settles the match at once, which opens the next matchup
      // with the result of the one that just finished.
      await page
        .locator(".bracket-round-item--left .MuiCardActionArea-root")
        .click();
      await page
        .locator(".bracket-reveal-stage")
        .waitFor({ timeout: 20000 })
        .catch(() => {});
      await sleep(900);

      const reveal = await page.evaluate(() => {
        const stage = document.querySelector(".bracket-reveal-stage");
        const video = stage?.querySelector("video");
        const box = stage?.getBoundingClientRect();
        return {
          present: Boolean(stage),
          width: box ? Math.round(box.width) : 0,
          height: box ? Math.round(box.height) : 0,
          isVideo: Boolean(video),
          playing: video ? !video.paused && video.currentTime > 0 : false,
          muted: video?.muted ?? null,
          winnerTag:
            document
              .querySelector(".bracket-reveal-winner-tag")
              ?.textContent?.trim() ?? null,
        };
      });
      t.metric("reveal", reveal);

      t.check(
        "match-result-shows-the-winning-clip",
        reveal.present && reveal.isVideo && reveal.width > 200,
        JSON.stringify(reveal),
      );
      t.check(
        "winning-clip-plays-itself",
        reveal.playing && reveal.muted === true,
        JSON.stringify(reveal),
      );
      t.check(
        "winning-clip-is-labelled",
        reveal.winnerTag === "WINNER",
        JSON.stringify(reveal),
      );

      t.check(
        "board-renders-without-console-errors",
        consoleErrors.length === 0,
        JSON.stringify([...new Set(consoleErrors)].slice(0, 3)),
      );
    } finally {
      await browser.close();
    }
  },
);
