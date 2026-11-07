# LAST SIGNAL v2.2.0 — ECHO NEURAL (experimental)

- Adds an 8→8→5 lightweight neural value model per AI individual. Same network structure and initial parameters for all 20 brains; no prescribed personalities or ideology.
- Inputs: 5 combat-context one-hot values, current HP fraction, distance to target, visible enemy count.
- Neural output contributes a bounded adjustment to the existing ECHO MEMORY action values (0.38 multiplier). Existing tactical decision and exploration rules remain.
- Neural weights update from the same combat success/failure signals as ECHO MEMORY. Models are saved in the local JSON memory and restored on import. Older exports automatically receive blank neural networks; original historical data is preserved.
- Research screen shows neural update counts for each brain. All 20 brains remain registered and each match draws 10.
- No GitHub auto-save, no predetermined ideology, no belief switching yet.

## Limitations / test status
- Static JavaScript syntax and offline simulation checks completed; browser gameplay, performance and difficulty require playtesting.
- Neural networks trained from limited experience can behave worse, and update counts are not proof of improvement.
- Existing ECHO MEMORY learning has been retained, including its pre-existing reward design; a later phase should evaluate reward neutrality before introducing explicit survival beliefs.
