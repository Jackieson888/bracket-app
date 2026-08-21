# QA suite

End-to-end checks that drive the real HTTP API and the real websocket runtime
the way the browser client does — REST join to mint a participant token, socket
connect, `join`, then `auth` with that token. Anything that skips the `auth`
step is dropped by the server and tests nothing, which is why the scenarios all
go through `Player.enter`.

## Running it

```bash
npm run dev            # in one terminal
npm run qa             # in another
```

Flags:

| flag | effect |
| --- | --- |
| `--only=solo-game,host-handoff` | run just these scenarios |
| `--skip-slow` | drop scenarios that wait out a grace period |
| `--keep-data` | leave the brackets and sessions the run created |
| `--out=qa/output/run.json` | where the JSON report goes |

`board-visuals` drives a real browser and needs Playwright's Chromium:

```bash
npx playwright install chromium
```

Everything else is HTTP and websockets only; the scenario skips itself when the
browser is not there.

Environment:

| variable | default | notes |
| --- | --- | --- |
| `QA_BASE_URL` | `http://localhost:3000` | the app under test |
| `QA_WS_URL` | `<base>/ws` | set when the runtime runs standalone |
| `QA_HOST_HANDOFF_GRACE_MS` | `15000` | must match the server's `HOST_HANDOFF_GRACE_MS` |

The host-handoff scenario waits out the real grace period, so start the server
with a short one to keep the run quick:

```bash
HOST_HANDOFF_GRACE_MS=1500 npm run dev
QA_HOST_HANDOFF_GRACE_MS=1500 npm run qa
```

## It writes to a real database

There is no test database — the app talks to whatever `MONGODB_URI` points at,
so the suite does too. Every bracket, session and game result a run creates is
tracked and deleted when it finishes; pass `--keep-data` to inspect the
wreckage instead. If Mongo is unreachable the run still executes but says so
and leaves its data behind.

A scenario that walks away from a game in progress leaves a room whose match
timer keeps force-advancing it in the background; left alone it finishes
minutes later and records a game result the run is no longer around to delete.
The runner settles those rooms before it sweeps, so this should not happen —
but a run killed part way through, or one of the one-off probes, still can.

```bash
node qa/sweep-qa-data.mjs            # dry run: counts only
node qa/sweep-qa-data.mjs --delete   # actually delete
```

It removes anything titled `QA …` plus game results with no `bracketId` and no
`bracketTitle` — the orphan shape, which nothing in the app can read.

## What is covered

| scenario | what it proves |
| --- | --- |
| `create-bracket` | A bracket saves, comes back from the list and search, and turns into a room code. Bad room codes 404, empty brackets are refused, tokens never appear in the public session payload. |
| `solo-game` | One player is host and quorum of one: every vote settles its match immediately, and the winner persists. |
| `bye-handling` | An odd-sized bracket carries the leftover item forward on a bye. |
| `waiting-room-and-async-voting` | Four players in a lobby see the same roster, only the host can start, votes cast at different times each move the counter on every screen, the match waits for the last voter, re-voting replaces rather than double-counts, live choices stay hidden, majority wins, and the host can force a stalled match. |
| `tie-breaks-with-a-coin-flip` | Sixteen deliberately tied matches in one room: every winner is one of the two contenders and both sides win at least once, which is what separates a coin flip from a fixed fallback. |
| `quorum-follows-the-room` | A player closing their tab lowers the bar instead of stalling the match. |
| `late-join-lockout` | After the start has been persisted, newcomers are refused by both the API and the socket, while known players can still rejoin. |
| `late-join-during-the-start-window` | The same thing in the instant the host starts — see "Known failures". |
| `reconnect-rehydration` | State survives everyone dropping, returning tabs land back on the live match with history intact, the host keeps the role, and Play Again resets the same bracket for everyone. |
| `host-handoff` | When the host vanishes, the earliest remaining player takes over and can start. |
| `match-deadline-settles-a-stalled-match` | One player never voting does not freeze the room: the published deadline settles the match with the votes in hand and arms the next one. Waits out the real vote window, so it is tagged slow. |
| `expired-room-is-retired` | A room aged past its expiry 404s on lookup and on join, and serves none of its old state to a socket — which is where it also catches the runtime handing out fresh rooms for dead codes, see "Known failures". |
| `identity-and-auth` | An unverified socket cannot start or vote and is not counted in the quorum; a forged token is refused on the socket and at the join endpoint. |
| `rate-limits` | Room creation from one address is capped and says when to retry. |
| `game-history-and-bracket-stats` | A finished game is written to `gameResults` with real item ids and feeds the play count and top item on the bracket cards. Guests are counted, never named. |
| `board-visuals` | Drives the board in a real browser: both stills load *and* have a box with real width to paint into, titles render over them, the countdown is absent while there is still time, the result reveal between matches plays the winning clip muted, and the page logs no console errors. Skips itself if Playwright is missing or no bracket has media. |

## Known failures

Two checks fail against the current code, and both failures are real. The
first is a race, so it fails intermittently — treat a pass as "the timing did
not line up this run", not as the bug being gone.

**`late-join-during-the-start-window`** (intermittent). `POST /api/sessions/[slug]` decides
whether a game has started by reading `roomStatus` from Mongo, but the
websocket runtime flips the room to `started` in memory and broadcasts
`game-started` before that write lands. A join arriving inside that gap is
judged against a stale `waiting`, gets a 200 and a participant token, and
sometimes ends up in the session document's `participantIds` — where a room
rebuilt from Mongo would accept them as a known player. (Whether they stick is
a race between the join's `$addToSet` and the runtime's next snapshot write, so
the suite records it as the `strangerLeftOnRoster` metric instead of asserting
on it.) Making the guard part of the write
(`updateOne` matching `roomStatus: { $ne: "started" }` for unknown
participants, treating `matchedCount === 0` as the 409) closes it. The live
room still refuses them, so this is a hole in the door rather than an open one.
`qa/tmp`-style probes that fire the join in the same instant as the start
reproduce it every time; inside a full suite run it lands maybe one run in
three.

**`expired-room-socket-is-turned-away`.** `getOrCreateRoom` builds a room for
whatever slug a socket asks for once `loadPersistedRoom` comes back empty, so
an expired — or entirely invented — room code gets a live socket and an empty
lobby rather than being turned away. Nothing of the old room leaks and nothing
is written back to Mongo, so the cost is a confusing lobby and a room object
per made-up code. Rejecting a slug with no session document would fix it.

## Older scripts

`multiplayer-qa-runner.mjs` predates participant tokens: it never sends `auth`,
so today the server ignores everything it does after connecting. This suite
replaces it. The single-purpose probes (`host-handoff-check.mjs`,
`ws-diagnostic.mjs`, `persist-race-probe.mjs`, and friends) are still useful for
poking at one behaviour by hand.
