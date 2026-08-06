#!/usr/bin/env node
// The legacy council portal rejects modern HTTPS/TLS fingerprints on GitHub-hosted
// runners. Keep the existing workflow entry point, but use the council's own
// exact-host legacy HTTP endpoint with explicit private-use provenance.
await import("./prefetch-planning-portal-http.mjs");
