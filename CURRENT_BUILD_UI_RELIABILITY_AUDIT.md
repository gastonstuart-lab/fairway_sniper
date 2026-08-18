# Fairway Sniper current-build UI reliability audit

Audit target: `main` at `f8537f59b620f7aaa386e32326cc0a3804e562d6`.

This pass deliberately avoids redesigning the product. The goal is to make the current build readable before visual redesign work, without touching the proven booking engine.

## Verified blocker fixed

The application uses `ThemeMode.system`, but both booking wizards render intentionally hard-coded dark surfaces (`Colors.black` in Normal Booking and `#1a1a1a` in Sniper Booking). On a computer using the light system theme, inherited headings, labels and helper text could therefore resolve to the light theme's dark foreground and become difficult or impossible to read on the dark wizard surface.

The two wizard routes now receive the app's existing `darkTheme` above the wizard widget itself. This keeps the current dark wizard design intact while ensuring every inherited `Theme.of(context)` inside those flows resolves to readable dark-theme foregrounds, fields, chips, cards and disabled states.

## Whole-app source review

- Login: explicit white hero foreground and explicit dark text on the white login card; no blocking contrast defect found.
- Mode selection: responsive desktop/narrow layout; wizard launch point was the correct place to fix the theme mismatch.
- Normal booking wizard: hard-coded black shell with inherited theme text; fixed by the route-level dark theme.
- Sniper booking wizard: hard-coded dark shell with inherited theme text; fixed by the route-level dark theme.
- Dashboard: live production state, PREP/FIRE times and countdown are already surfaced; no booking logic changed in this audit.
- Shared player selector/editor: both are used by these wizard flows and now inherit the consistent dark route theme.
- Course information: no booking-path blocker found in source review.
- Admin dashboard: styling is less consistent but is not part of the normal booking path; cosmetic work is deferred.

## Explicitly unchanged

- Node/Railway booking engine
- PREP/FIRE scheduling
- BRS login/session automation
- player IDs and capacity validation
- tee and slot selection
- Firestore job schema
- safe proof boundary
- final real booking submission logic

## Deployment rule

This draft branch must not be merged or deployed while the currently scheduled real sniper is waiting to fire. CI and review are safe; production remains frozen.
