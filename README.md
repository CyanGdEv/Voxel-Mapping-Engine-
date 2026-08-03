# Voxel Mapping Engine

A cloud-hosted generator that converts public geospatial evidence into a pre-generated Minecraft Bedrock `.mcworld`.

## Generate Chessington from a phone

1. Open this repository in GitHub.
2. Open **Actions**.
3. Select **Build Minecraft Theme Park World**.
4. Tap **Run workflow**.
5. Keep `preset` set to `chessington` and `quality` set to `maximum-public`.
6. Start the workflow.
7. When it finishes, open the run and download the artifact ending in `-mcworld`.
8. Unzip the GitHub artifact in the iOS Files app and tap the contained `.mcworld` to import it into Minecraft.

See [`MOBILE_GITHUB_ACTIONS.md`](MOBILE_GITHUB_ACTIONS.md) for setup, custom parks, troubleshooting, and output details.

## Source layout

The v0.12.0 source release is stored as split Base64 parts under `.source/`. GitHub Actions reconstructs and expands the source bundle on the cloud runner before installing dependencies. This keeps the initial phone-ready repository upload atomic and reproducible.
