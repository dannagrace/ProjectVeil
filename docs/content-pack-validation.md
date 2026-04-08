# Content Pack Validation

`npm run validate:content-pack` validates the shipped default content pack, and `npm run validate:content-pack:all` first runs the Phase 1 map-object visual coverage precheck before extending the same content-pack checks across the additional shipped map-pack presets.

The validator is intended to fail before runtime when authored config would otherwise be silently normalized or only break after archive hydration, equipment reconciliation, or reward application.

If you are editing boss encounter templates, use [`docs/boss-encounter-template-authoring.md`](./boss-encounter-template-authoring.md) for the template shape, allowed field values, and the authoring workflow that feeds this validator.

## Local Workflow

Run the default shipped bundle:

```bash
npm run validate:content-pack
```

Run every shipped bundle:

```bash
npm run validate:content-pack:all
```

Run just the Phase 1 map-object visual coverage audit:

```bash
npm run validate:map-object-visuals
```

Write a machine-readable report artifact:

```bash
npm run validate:content-pack -- --report-path artifacts/release-readiness/content-pack-validation.json
```

Target an alternate preset while editing one pack:

```bash
npm run validate:content-pack -- --map-pack ridgeway-crossing
```

For the shipped `highland-reach` Phase 1 pack:

```bash
npm run validate:content-pack -- --map-pack highland-reach
npm run test:phase1-release-persistence:highland
```

`highland-reach` is the wider 10x10 Phase 1 variant with mirrored gold pockets, dual recruitment posts, and a denser four-neutral midline, so reviewers should expect slower first contact and more meaningful routing choices than the default baseline pack.

The CLI prints the document path, issue code, human-readable failure, and a suggested fix for each failing entry.

`validate:map-object-visuals` treats missing or mismatched coverage entries in `configs/object-visuals.json` as errors, while stale extra node mappings only surface as warnings so authors can clean them up without blocking unrelated pack validation.

## CI Workflow

CI already runs the validator as a standalone step in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) with:

```bash
npm run validate:content-pack -- --report-path "${RUNNER_TEMP}/content-pack-validation-report.json"
```

That step uploads the generated report artifact so reviewers can inspect the exact diagnostics from the candidate revision.

## Typed Checks Covered

- Hero progression fields must stay compatible with runtime progression math.
- Learned hero skills must match the shipped hero skill tree, including max rank, required level, and prerequisites.
- Authored skill-point totals must fit the hero's current level.
- Equipped and inventory items must resolve through the built-in equipment catalog, respect slot typing, and stay within the six-slot backpack limit.
- Legacy `loadout.equipment.trinketIds` entries are rejected so authors migrate to `accessoryId` plus `inventory` before archive/persistence use.
- Neutral-army rewards and guaranteed resource payloads must use positive integer amounts.
- Boss encounter templates must use valid phase ordering, known skill/status/unit references, and valid scripted ability plus environmental effect fields.

## Common Invalid States

Invalid progression level for authored XP:

```json
{
  "progression": {
    "level": 1,
    "experience": 175
  }
}
```

Fix: raise `level` to the minimum produced by that XP total, or lower `experience`.

Invalid equipment slot + overflowed inventory:

```json
{
  "loadout": {
    "equipment": {
      "weaponId": "padded_gambeson"
    },
    "inventory": [
      "militia_pike",
      "vanguard_blade",
      "padded_gambeson",
      "scout_compass",
      "oak_longbow",
      "tower_shield_mail",
      "scribe_charm"
    ]
  }
}
```

Fix: move each item into a compatible slot and keep `inventory` at six items or fewer.

Invalid legacy accessory migration:

```json
{
  "loadout": {
    "equipment": {
      "trinketIds": ["scout_compass"]
    }
  }
}
```

Fix: move one accessory into `loadout.equipment.accessoryId` and place any extras into `loadout.inventory`.

Invalid reward payload:

```json
{
  "reward": {
    "kind": "gold",
    "amount": 0
  }
}
```

Fix: use a positive integer reward amount so resource grants, event logs, and persisted account state stay aligned.
