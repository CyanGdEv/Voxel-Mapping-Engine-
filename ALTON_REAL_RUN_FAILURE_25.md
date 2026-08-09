# Alton real-run failure 25 repair

Diagnostics `themepark-v0120-resilient-build-diagnostics 25` and `planning-prefetch-resilient-diagnostics 22` showed that planning prefetch was healthy and the Phase 30B material sampler passed. The build failed in assembled-generator integration that isolated phase CI did not exercise.

Root causes repaired on this branch:

- Phase 30B checksum-era semantic patch was tested before its deterministic handoff completion transform, producing a transient `site-path-centerline-candidate` failure even though the following fragment could repair it.
- Phase 34 installed terrain/building stages before the ride-profile anchor they require.
- Phase 34/35 copied regression tests into `generator/test` while retaining test-local imports for implementations that actually live in `generator/src/lib`.
- Several Phase 34/35 numeric helpers used `Number(null)`, converting unresolved elevation into `0`.
- Phase 35 block-state transport exact-matched an historical full palette line, so legitimate later material additions broke its installer.
- Final Alton compatibility required an obsolete exact-cardinality assertion even when the planning-vector regression had already been modernized.

The repair keeps planning-only authority and all geometry/terrain/QA thresholds unchanged. It makes integration structural, idempotent and validated before the production tests execute.
