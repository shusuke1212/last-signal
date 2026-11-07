# LAST SIGNAL v2.5.0 — SOFT COVER / CROUCH

## Changes
- Touch UI: CROUCH / STAND toggle; desktop Shift hold remains unchanged. Jump releases crouch.
- Simple low hedges in sparse positions around settlements and in training range. No new gun pickups.
- Hedges obstruct movement and eye-level sight when crouched, but **do not stop projectiles**. Hard cover keeps existing projectile/vision rules.
- A training target is behind one hedge for projectile penetration testing.
- Crouched player's projectile hit sphere is reduced and lowered to follow crouch posture.
- AI learning.js, AI action selection and persisted learning format have not been modified.

## Caveats
- This is binary sight occlusion, not a probabilistic camouflage model.
- The mobile control layout, occlusion/ballistics and performance must be verified on real devices.
- Different builds opened at different URLs may not share browser localStorage; preserve echo_memory_export.json.
