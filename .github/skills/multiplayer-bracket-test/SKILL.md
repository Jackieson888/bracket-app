---
name: multiplayer-bracket-test
description: 'End-to-end multiplayer bracket QA workflow for creating a bracket, adding items, inviting friends, joining the same session, playing rounds, and validating real-time sync and winner calculation correctness. Use when testing game session integrity, real-time updates, and bracket progression.'
argument-hint: 'Optional: env/base URL, account names, player count, and any known risk areas to focus on'
user-invocable: true
---

# Multiplayer Bracket Test Workflow

## Outcome
Produce a repeatable, evidence-backed validation that this app supports:
- Bracket creation and item setup
- Selecting a saved bracket to play it (creates a room/session for that bracket)
- Friend invitation via room code and multi-user join flow
- Host-gated game start only after friends have joined
- Late-join lockout: once the host starts the game, only participants who had
  already joined may be let into the room (both the WebSocket layer and the
  `POST /api/sessions/[slug]` join API must enforce this)
- Same-session participation for invited players
- Real-time state synchronization across players
- Correct round progression and winner calculation
- Disconnect/reconnect resilience: a player who drops mid-session can
  reconnect into the same room and picks up exactly where the room left off
- Post-winner options: the host can trigger a same-bracket rematch ("Play
  Again"), and any player can back out to pick a different bracket

## When to Use
- Before releases that touch session, gameplay, realtime, or scoring logic
- After changes in [app/api/brackets/route.tsx](app/api/brackets/route.tsx), [app/api/sessions/route.tsx](app/api/sessions/route.tsx), [app/play/[slug]/play-bracket-game.tsx](app/play/[slug]/play-bracket-game.tsx), or [realtime-runtime/ws-runtime.js](realtime-runtime/ws-runtime.js)
- When investigating reports of desync, incorrect bracket advancement, or wrong winners

## Required Inputs
- Environment/base URL to test
- At least 2 test player accounts (host + invited friend)
- Test bracket shape (for example: 4 or 8 items)
- Expected winner path for at least one deterministic scenario

## Test Procedure

### 1. Preflight
1. Verify backend dependencies are reachable and app is running.
2. Verify authentication works for all test accounts.
3. Confirm clean baseline: no stale sessions that can affect this run.
4. Capture baseline metadata:
   - Timestamp
   - Commit/version under test
   - Environment

### 2. Host Creates Bracket
1. Sign in as host account.
2. Create a new bracket.
3. Add bracket items according to the chosen scenario.
4. Save and confirm the bracket is retrievable from the app/API.
5. Record bracket identifier and expected round structure.

### 3. Invite and Join Flow
1. From host, select the saved bracket and create/open a play session for it
   (`app/play/page.tsx` bracket list → `POST /api/sessions` with the full
   bracket object, matching `handlePlayItem`).
2. Invite friend players using the room code (the session `slug`, shown and
   copyable from the waiting room).
3. Sign in as each invited player in separate browser contexts.
4. Accept invite/join via the room code entry on `/play` or a direct
   `/play/[slug]` link.
5. Validate all players show the same session identity (same session id/slug) and same participant roster.

### 3a. Host-Gated Start
1. Confirm the "START GAME" control is only rendered/actionable for the
   participant whose id matches the room's `hostParticipantId` (broadcast via
   `room-state` and the session API).
2. Confirm non-host players see a waiting indicator instead, and that a
   `start-game` message sent by a non-host is rejected with `start-denied`
   and does not change room state.
3. Host triggers `start-game` only after at least one friend has joined;
   confirm all connected clients receive `game-started` with matching
   `roomStatus`/`gameState`.

### 3b. Late-Join Lockout
Once `roomStatus` is `"started"`, a participant who was never part of the
room's roster must not be able to get in through either integration point:
1. WebSocket: a new socket connecting with an unrecognized `participantId`
   must receive a `room-locked` message and have the connection closed
   before it is added to the room's client list.
2. REST: `POST /api/sessions/[slug]` with an unrecognized `participantId`
   must be rejected (409) and must not be written to `participantIds`/
   `participantLookup`.
3. Regression guard: a participant who *was* already in the roster must
   still be able to reconnect (WS) or refresh their identity (REST POST,
   e.g. a display-name update) while the game is in progress — the lockout
   is about new joiners, not existing players.

### 4. Real-Time Synchronization Checks
1. Establish a synchronization checkpoint before moves begin.
2. Perform one player action at a time (pick winner/advance matchup).
3. After each action, validate on all clients:
   - UI state updates without manual refresh
   - Same matchup result and round position
   - Same current turn/state marker (if applicable)
4. Repeat for multiple actions across at least two rounds.
5. Capture latency or ordering anomalies (late updates, duplicate updates, conflicting states).

### 5. Round Progression and Winner Validation
1. Execute a deterministic match outcome path with known expected champion.
2. At each round boundary, validate:
   - Correct participants advance
   - No eliminated item reappears
   - Next round pairings are correct
3. Complete the bracket and verify final winner matches the expected outcome.
4. Validate all connected clients display the same final winner and completed state.

### 6. Persistence and Refresh Validation
1. Refresh each client and confirm session/bracket state is preserved.
2. Reopen app and navigate back to the same play route.
3. Validate persisted round data and winner remain consistent.
4. Fully disconnect a client mid-round (close the socket entirely, not just
   navigate away) and confirm the room's persisted state is unaffected.
   Reconnect that client with the same `participantId` and confirm it
   hydrates to the exact round/match/vote-tally the room is currently at —
   this is the "reconnect back into the instance" requirement, not just a
   page refresh.

### 7. Post-Winner Flow (Play Again / Different Bracket)
1. Drive a bracket to completion and confirm the winner overlay renders for
   every connected client.
2. Confirm only the host sees a "PLAY AGAIN" control; other players do not.
3. Non-host sends `start-game` anyway (simulating a forged/replayed
   request) — confirm it is denied (`start-denied`) and room state stays
   `"completed"`.
4. Host triggers "PLAY AGAIN": confirm every connected client (host and
   guests, without them re-sending anything) receives a fresh
   `game-started` with `round: 0`, a fresh `currentMatch`/vote state, and
   the *same* bracket items as the original game (not a different bracket).
5. Confirm "DIFFERENT BRACKET" is available to every player (host and
   guests) at all times on the winner screen and navigates to the bracket
   picker (`/play`) rather than attempting any in-room action.

### 8. Negative and Resilience Checks
1. Late-join test: uninvited/new user cannot join a started session via
   either the WebSocket or the REST join API (see 3b).
2. Duplicate action test: repeated submit/click does not double-advance bracket.
3. Concurrent action test: two users act nearly simultaneously; system resolves deterministically.
4. Temporary disconnect test: reconnecting client catches up to canonical state.
5. Rematch authorization test: a non-host cannot trigger "Play Again" (see
   section 7).

## Decision Branches
- If invited users do not land in the same session:
  - Verify invite payload/session id mapping
  - Verify session lookup by slug/id on join route
  - Stop gameplay assertions until session identity is corrected
- If real-time updates are inconsistent:
  - Compare network events and persisted API state
  - Use persisted state as source of truth and identify stale client state
- If final winner is wrong but round events look right:
  - Inspect bracket reduction/advancement logic and finalization path
  - Re-run with minimal 4-item deterministic scenario to isolate logic

## Automated Runner
[qa/multiplayer-qa-runner.mjs](../../../qa/multiplayer-qa-runner.mjs) is a
Node script that exercises this workflow end-to-end against a running local
server (`npm run dev`, which serves both Next.js and the WebSocket runtime on
`http://localhost:3000`): create bracket → select/play it → join by code →
host-gated start → late-join lockout (WS + REST) → real-time voting/round
progression → full disconnect/reconnect → winner correctness → non-host
rematch denial → host "Play Again" resetting the same bracket for everyone.
Run it with `node qa/multiplayer-qa-runner.mjs`, capture stdout (JSON) to a
timestamped file under `qa/`, and treat any `pass: false` entry in `checks`
as a defect to map in the Issue Map. It does not cover the "DIFFERENT
BRACKET" navigation (pure client-side link to `/play`) or visual/UI
rendering — verify those manually in a browser.

## Completion Criteria
- All invited players are confirmed in the same session
- Only the host can start the game, and only after at least one other player has joined
- Once started, no new/unrecognized participant can join via WebSocket or the REST join API
- Real-time updates are consistent across all active clients for each action
- Round progression matches expected pairings and eliminations
- Final winner is correct for deterministic scenarios
- A fully disconnected client reconnects and hydrates to the room's canonical state
- Only the host can trigger a rematch, and it replays the same bracket for every connected client
- "Different bracket" is available to every player from the winner screen
- No critical desync, duplicate-advance, or persistence regressions remain

## Evidence to Capture
- Session id/slug observed by each player
- Screenshots or logs at key checkpoints (join, round transitions, final winner)
- Any API or websocket payload samples relevant to failures
- Short defect notes: reproduction steps, expected vs actual, severity

## Suggested Prompt Examples
- /multiplayer-bracket-test Run the full workflow on local dev with 2 players and a 4-item bracket.
- /multiplayer-bracket-test Focus on real-time desync risks during concurrent actions.
- /multiplayer-bracket-test Validate winner correctness for an 8-item seeded scenario.

## Customization Notes
Update this skill to match your exact domain rules:
- Session authorization model (public invite vs restricted invite)
- Tie-break or rematch behavior
- Deterministic seeding logic and special bracket rules
- Required telemetry/log sources for diagnostics