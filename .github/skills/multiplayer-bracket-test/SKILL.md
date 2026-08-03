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
- Friend invitation and multi-user join flow
- Same-session participation for invited players
- Real-time state synchronization across players
- Correct round progression and winner calculation

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
1. From host, create or open a play session for the bracket.
2. Invite friend players using the app's invite mechanism.
3. Sign in as each invited player in separate browser contexts.
4. Accept invite/join via invite link or session code.
5. Validate all players show the same session identity (same session id/slug) and same participant roster.

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

### 7. Negative and Resilience Checks
1. Invalid invite test: uninvited user cannot join restricted session (if auth rules require restriction).
2. Duplicate action test: repeated submit/click does not double-advance bracket.
3. Concurrent action test: two users act nearly simultaneously; system resolves deterministically.
4. Temporary disconnect test: reconnecting client catches up to canonical state.

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

## Completion Criteria
- All invited players are confirmed in the same session
- Real-time updates are consistent across all active clients for each action
- Round progression matches expected pairings and eliminations
- Final winner is correct for deterministic scenarios
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