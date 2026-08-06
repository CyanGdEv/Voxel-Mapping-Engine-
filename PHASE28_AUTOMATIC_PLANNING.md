# Phase 28 — One-click automatic planning pipeline

Phase 28 removes manual planning-drawing registration from the normal player workflow.

The player selects a supported park. The workflow then performs planning discovery, document acquisition, evidence balancing, automatic drawing registration, vector extraction, safety validation, source fusion and Bedrock world packaging without additional player input.

## Expanded planning acquisition

For Alton Towers the production workflow searches up to 300 official planning applications, considers up to 1,200 documents and permits a 150 MB verified planning-evidence cache. The balanced downloader distributes high-value documents across applications instead of allowing a single large case to consume the full budget.

Discovery covers the official major register, application search, address and pagination expansion, and related-application references available through the official Staffordshire Moorlands portal flow.

## Automatic registration

The Phase 28 patch adds an OpenCV-based automatic registration tool. It compares planning-page evidence against bounded geospatial reference geometry, evaluates candidate transforms and passes only accepted transforms into the existing planning georeference, vector extraction and authority gates.

Manual control points remain an optional diagnostic fallback only. They are not required for the park-only production workflow.

## Fail-closed behaviour

More downloaded planning material does not automatically become world geometry. Drawings that cannot be registered with sufficient confidence, or whose status, licence, implementation evidence, geometry, overlap, displacement or ambiguity checks fail, remain evidence-only.

## Player workflow

The GitHub Actions workflow exposes only one input: the park selector. Accuracy, planning acquisition, registration, evidence thresholds, supplemental sources and packaging settings are managed by validated production defaults.

## Validation

Pull-request CI validates:

- the complete Phase 20–28 patch chain;
- checksum-locked Phase 28 source assembly;
- JavaScript and Python syntax;
- OpenCV automatic-registration self-tests;
- planning acquisition, coverage, georeference, vector extraction and fusion suites;
- cross-platform live planning-prefetch selection.
