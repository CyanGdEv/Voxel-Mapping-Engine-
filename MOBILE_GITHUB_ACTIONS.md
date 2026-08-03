# Run the theme-park generator from a phone

The included GitHub Actions workflow runs the complete generator on GitHub's Linux infrastructure. No local computer or terminal is required.

## One-time repository setup

1. Open **Settings → Actions → General**.
2. Confirm that GitHub Actions is allowed to run in this repository.
3. Open **Settings → Secrets and variables → Actions → Variables**.
4. Add a repository variable named `TPMAP_CONTACT`.
5. Set it to an email address or a public project URL. Mapping services expect an identifiable contact in automated requests.

The workflow falls back to the repository URL if this variable is not set.

## Build Chessington

1. Open **Actions**.
2. Select **Build Minecraft Theme Park World**.
3. Tap **Run workflow**.
4. Choose:
   - Preset: `chessington`
   - Quality: `maximum-public`
   - Provider failure mode: `continue`
   - World margin: `32`
5. Tap the green **Run workflow** button.

`continue` is recommended because it allows the world to complete when one optional public API has no coverage or is temporarily unavailable. The source-acquisition report records every success and failure.

## Download on iPhone or iPad

1. Open the completed workflow run.
2. Scroll to **Artifacts**.
3. Download the artifact whose name ends in `-mcworld`.
4. GitHub downloads a ZIP containing the world and reports.
5. Open the ZIP in the Files app.
6. Tap the `.mcworld` file and open it with Minecraft.

## Custom park

Choose the `custom` preset and provide:

- `park_name`: the displayed park name.
- `bbox`: `south,west,north,east`.

Example:

```text
51.3458,-0.3228,51.3535,-0.3133
```

## Successful artifact contents

- Directly importable `.mcworld`
- Accuracy report
- Independent validation report
- Source-acquisition manifest
- Source-fusion manifest
- Evidence and fidelity reports
- Ride-profile report
- World manifest
- Preview files
- Full build log

Failed builds upload a diagnostics artifact wherever possible.
