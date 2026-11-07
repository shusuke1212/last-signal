# LAST SIGNAL v2.0.0 — WORLD DIVERSITY (experimental)

## Changes
- Keeps v1.9.0 ECHO POPULATION: 20 persistent brains, 10 unique participants per match, JSON export/import.
- Adds an industrial warehouse/container region to the eastern area of the map, with gaps and multiple approach routes.
- Adds a narrow cover corridor in the western region while leaving open spaces for long-range engagements.
- Adds short-range obstacle detour attempts to AI movement when a step is obstructed. This affects AI only, not player input; it is *not* full pathfinding.
- Changes runtime version label to 2.0.0.

## Not yet implemented
- Terrain elevations/hills, full navigational pathfinding, fairness audit, neural network, beliefs/ideology system, shared online storage.
- Game remains a browser-local learning system: NO automatic upload to GitHub.

## Upgrade and cautions
- Export the ECHO MEMORY JSON before replacing files.
- Deploy the entire LAST_SIGNAL_COMPLETE directory contents on the same GitHub Pages origin to retain localStorage.
- Do not delete browser site data. On a new device, use the research screen's JSON import.
- The map is still deterministic between matches and colliders are simple AABBs.

## Validation
- node --check for game.js and learning.js passed.
- Static structural checks for terrain insertion and AI navigation performed.
- Browser playability, performance, collisions in dense scenes and balancing are **not** yet verified on physical devices.
