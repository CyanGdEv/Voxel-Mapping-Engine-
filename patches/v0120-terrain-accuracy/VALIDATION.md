# Validation

Completed before publication:

- source patch applies cleanly to the checksum-locked v0.12.0 archive;
- every modified and added JavaScript module passes `node --check`;
- all five GitHub Actions runner fragments assemble into one script that passes `bash -n`;
- committed Git blob hashes match the locally validated files;
- the patch checksum is verified by the runner before application.

The dependency-backed tests and live Environment Agency WCS acquisition run on the GitHub-hosted workflow because the local sandbox package mirror does not provide every locked dependency.
