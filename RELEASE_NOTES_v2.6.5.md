# v2.6.5 LAB NAVIGATION FIX

- The DEVELOPER LAB launcher belongs to the title screen, behind the full-screen ECHO MEMORY overlay. Its underlying outline is not a card-layer bug.
- Added `◇ DEVELOPER LABへ` to the ECHO MEMORY research tools while the title screen is visible. Clicking closes the research overlay then invokes the existing guarded title-only launch handler.
- The link is hidden when the title screen is unavailable (for example, in a match); batch-match guards remain intact.
- Existing research exports/imports, study memory, game logic and other buttons unchanged.
