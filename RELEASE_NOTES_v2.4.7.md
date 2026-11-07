# LAST SIGNAL v2.4.7 ENVIRONMENT & SOUND CUE

- Terrain: deterministic low-cost ground variation, without changing height or collider physics.
- Obstacles: improved tree canopy silhouette and screening-wall visual accents. Tree and pillar collision logic intentionally retained for field verification.
- Tactical Map: title and coordinates are now outside the plotted map; the canvas uses nearly the full plotting space.
- Gunfire: when an enemy shot is within the existing hearing distance, briefly flash the corresponding screen edge (player-relative left/right). Short throttle, visual only; no changes to AI behavior or learning.
- No ADS adjustment in this release.
- Existing learning data remains local to the browser. Export a copy of echo_memory_export.json before replacing an old installation.

## Test checklist
1. Open index.html or play/index.html through the same local HTTP server and test standard match.
2. Check that map player marker remains visible even at its upper/lower edges.
3. Have an AI fire from left and right within hearing range; confirm the edge flash and existing sound wedge.
4. Walk around grove trunks and screening walls, including collision and projectile tests.
5. Compare game saves before/after; no learning reset or format changes are intended.
