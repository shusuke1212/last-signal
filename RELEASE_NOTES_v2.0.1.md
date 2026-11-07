# LAST SIGNAL v2.0.1 – FAIR CONTACT

- Preserves 20-brain population and 10 random entrants from v1.9/v2.0.
- AI checks physical line of sight again at the moment it commits to shooting, after movement. It cannot deliberately shoot at a just-occluded target based on the pre-movement sight test. Projectiles still use physical collision.
- Taking damage no longer supplies equally precise opponent-location evidence when a wall blocks line of sight. Occluded observations have greater uncertainty and shorter life.
- NPC obstruction avoidance retains the chosen lateral direction to reduce flip-flopping. This is local steering, not full pathfinding.
- In-game ECHO name now follows persistent brainId rather than temporary spawn slot, so tracking a character across matches is easier.
- No network/GitHub data writing was added. Browser saved learning is preserved, with JSON export/import as before.

## Limits
- AI and human do not yet have identical perception/movement systems. These changes target specific unfair information leaks, not certified full parity.
- Automated syntax checks are not a substitute for browser playtesting.
