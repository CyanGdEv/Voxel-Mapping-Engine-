# Path Phase 2A — Natural Top-Surface Replacement

ThemePark Map v0.11.4 allows accepted path and plaza polygons to replace grass and other natural top-surface blocks while preserving the source terrain elevation and subsurface terrain.

## Rules

- Paths and plazas replace only the top terrain block.
- DTM height is unchanged by surface painting.
- Plaza polygons paint their complete detected area.
- Buildings, water, and woody vegetation remain exclusion evidence.
- Build reports include unique natural-ground cells replaced.

## Validation

- 14/14 focused tests passed.
- A dedicated regression test verifies that path plazas do not create raised layers.
