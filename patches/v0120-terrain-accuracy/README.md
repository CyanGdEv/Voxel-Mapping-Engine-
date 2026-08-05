# v0.12 terrain accuracy upgrades

This patch is applied after the checksum-locked v0.12.0 source archive is extracted by GitHub Actions.

It adds:

- Environment Agency Vegetation Object Model canopy-height acquisition;
- canopy sampling limited to the original park bounds even when the terrain context is much larger;
- fail-open handling when optional VOM evidence is unavailable;
- measured VOM height precedence for mapped and generated vegetation;
- the current Microsoft Global ML Building Footprints dataset index;
- Planning Data provider page-limit enforcement;
- regression coverage for the source controls and selection behavior.

Patch SHA-256:

```text
ef0c7f932386647a2d200c795823f4bda92a56a647d32dcb236f9e150e203531
```
