# LAST SIGNAL v2.5.6 — NPC MOVEMENT RECOVERY

## Changes
- NPCs remember a temporary detour around a blocking obstacle instead of choosing a new left/right step on every frame.
- The detour uses the collision shape of the obstacle and navigates via a reachable corner; navigation ends on arrival, timeout, goal change, or combat interruption.
- Dense vegetation retains the pre-existing short-distance sidestep fallback.
- Only NPC locomotion was adjusted. Player movement, NPC reward/learning parameters, weapon balance, ADS, vision and sound rules remain unchanged.
- MOVEMENT AUDIT (AI and player) is preserved. Before/after logs can be compared using the same metrics.

## Validation
- JavaScript syntax validated with node --check.
- Deterministic movement simulations tested: single wall, long building, two blocks, scattered trunks, all reached destination without teleportation.
- No full browser/device playtest in this build environment. Observe FPS, blocked time and patrol reach frequency in actual matches.
