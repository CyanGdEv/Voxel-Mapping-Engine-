# v0.11.3 source transformation

GitHub's connector stores this compressed source patch as six text-safe Base64 chunks.

The build driver concatenates `part-00.b64` through `part-05.b64`, verifies the encoded SHA-256, decodes and decompresses the unified patch, verifies its second SHA-256, and applies it after the v0.11.2 compiler compatibility patch.

The resulting generator source is ThemePark Map v0.11.3 Path Geometry Phase 1.
