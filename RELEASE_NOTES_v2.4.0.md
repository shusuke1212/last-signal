# LAST SIGNAL v2.4.0 — FAIR WORLD & RESOLUTION

## Changes
- Shared 11-player spawn allocation. Player and 10 selected AI receive shuffled collision-free positions; minimum spacing targeted at 95m.
- Terrain seeded per match, settlement positions vary within limited bounds, extra variable cover clusters including central terrain. Weapon pickup locations randomized across settlements and open terrain.
- Player elimination triggers a chunked accelerated simulation for remaining AI instead of ending AI learning immediately. It advances NPC perception, tactics, movement, projectiles, traps, and social learning with the same code as active play.
- Minimal genuine progress indicator tracks processed game time until final survivor or time limit. Prior result screen remains unchanged.
- Training range and ADS assist behavior preserved. No GitHub automatic saving.

## Caveats
- Browser gameplay/performance not yet verified on physical mobile hardware.
- Existing AI decisions use some realtime visual timing; background simulation follows gameplay combat rules but has minor non-deterministic scheduling differences.
- Very long matches or collision-heavy layouts can take noticeable CPU time; the progress indicator remains responsive between batches.
- No terrain elevation model has been introduced; cover layout and settlement placement are varied.
