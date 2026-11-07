# LAST SIGNAL v1.9.0 — ECHO POPULATION (first-stage update)

## Implemented
- Persistent AI population increased from 10 to 20; each ordinary match still spawns **10 AI**, chosen without replacement.
- Retains old brain IDs 0–9 and all existing Q scores, relationships, weapon records, match histories, and counters. New IDs 10–19 begin fresh.
- Existing browser `lastSignal.echoMemory.v1` memory automatically upgrades to 20 brains on launch. Storage key and format version remain the same.
- Research screen adds JSON import in addition to export, with confirmation and structural validation. This supports loading a backup from another browser/device.
- Research table now shows 20 entries, with a current name only for participating AI.

## Not implemented in this first-stage build
- Shared online learning or automatic GitHub writes (requires a secure write API, authorization, rate limiting, data verification, and conflict control).
- Neural-network inference/training, belief/ideology system, terrain redesign, or full player-versus-AI fairness audit.

## Upgrade / run
1. Back up the original files and use **JSON出力** on the old game's ECHO MEMORY before updating.
2. Replace the GitHub Pages site with the files in this package, preserving folder structure.
3. On the same browser/site origin, old memory is automatically upgraded; if a different browser or origin is used, open the research view and use **JSON読込** on the saved JSON.
4. On the title screen tap the title logo 5 times; enter the existing research access code to see the research view.
5. Do not import during a match. Do not reset without exporting a backup first.

## Verification
- Node JS syntax check of learning.js and game.js passed.
- Automated simulation checks confirmed migration of 6-match sample data, retention of existing Q-values, 20-brain population, 10 unique randomly sampled IDs each match, JSON import, and invalid-input rejection.
- Real-device input/performance and in-browser graphics gameplay have **not** been verified in this environment.
