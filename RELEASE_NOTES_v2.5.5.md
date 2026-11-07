# LAST SIGNAL v2.5.5 — MOBILE ADS FOLLOW RETUNE

Base: v2.5.4 PLAYER + AI MOVEMENT AUDIT.

- Touch ADS acquisition angle (non-scope): yaw 0.047 → 0.075 rad, pitch 0.052 → 0.080 rad; scope yaw 0.035 → 0.052 rad and pitch 0.037 → 0.050 rad.
- Initial near-crosshair hold: 0.20 → 0.10 s. Tracking acceleration: 0.42 → 0.20 s; tracking responsiveness: 3.6 → 6.2 /s.
- Retention zone moderately wider to help compensate for mobile movement while aiming.
- Still requires ADS + touch input + near-crosshair alignment + unobstructed line of sight. No acquiring through obstacles, no free scanning. Existing temporary OFF switch for LONGSHOT preserved.
- No changes to AI decision making, learning data, movement-audit fields, ammunition or knife mechanics.
- Test on device: target acquisition while stationary and strafing; verify no off-crosshair auto-lock and that lock drops behind solid cover.
