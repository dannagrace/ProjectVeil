# Boss Encounter Template Authoring Guide

Use this guide when editing [`configs/boss-encounter-templates.json`](../configs/boss-encounter-templates.json). Boss encounter templates are global authoring inputs that feed campaign mission references and the shared content-pack validator.

Pair this document with [`docs/content-pack-validation.md`](./content-pack-validation.md) when you need the broader content/config validation flow.

## Source Of Truth

Boss encounter templates live in [`configs/boss-encounter-templates.json`](../configs/boss-encounter-templates.json) under a top-level `templates` array. Each template defines:

- `id`: stable identifier used by campaign missions through `bossTemplateId`
- `name`: reviewer-facing display name
- `bossUnitTemplateId`: optional unit template id from `configs/units.json`
- `phases`: ordered health-threshold phases applied as the boss loses HP

The validator rejects an empty catalog, duplicate template ids, missing names, unknown `bossUnitTemplateId` values, and templates without phases.

## Phase Authoring Rules

Each phase entry must define:

- `id`: unique within the template
- `hpThreshold`: decimal threshold in `(0, 1]`

Author phases from highest HP to lowest HP:

- The first phase must use `hpThreshold: 1`.
- Every later phase must use a smaller threshold than the phase before it.
- At runtime, the battle layer picks the first phase whose threshold is less than or equal to the boss's remaining HP ratio.

Minimal shape:

```json
{
  "id": "boss-example",
  "name": "Boss Example",
  "bossUnitTemplateId": "shadow_hexer",
  "phases": [
    {
      "id": "phase-1-open",
      "hpThreshold": 1
    },
    {
      "id": "phase-2-enrage",
      "hpThreshold": 0.5
    }
  ]
}
```

## Skills And Scripted Abilities

Use `skillOverrides` to change the boss skill list per phase:

- `replaceSkillIds`: replaces the base list entirely
- `addSkillIds`: appends extra skills when they are not already present
- `removeSkillIds`: removes skills after replacement/addition

Every referenced skill id must exist in `configs/battle-skills.json`.

Use `scriptedAbilities` for deterministic pre-turn or post-turn actions:

- `id` must be a non-empty string
- `skillId` must exist in `configs/battle-skills.json`
- `timing` must be `pre_turn` or `post_turn`
- `target` must be `self`, `first_enemy`, `lowest_hp_enemy`, or `lowest_hp_ally`
- `oncePerRound`, when present, must be boolean

Example:

```json
{
  "id": "phase-2-bone-wall",
  "hpThreshold": 0.66,
  "skillOverrides": {
    "replaceSkillIds": ["grave_silence", "stunning_blow", "battle_focus"]
  },
  "scriptedAbilities": [
    {
      "id": "surge-before-strike",
      "timing": "pre_turn",
      "skillId": "battle_focus",
      "target": "self",
      "oncePerRound": true
    }
  ]
}
```

## Environmental Effects

Use `environmentalEffects` for hazards spawned by a phase. Every effect must define:

- `lane`: non-negative integer
- `name`: non-empty string
- `description`: non-empty string

`blocker` effects must also define:

- `durability`: positive integer
- `maxDurability`: optional positive integer

`trap` effects must also define:

- `effect`: `damage`, `slow`, or `silence`
- `damage`: non-negative integer
- `charges`: positive integer
- `grantedStatusId`: optional status id from `configs/battle-skills.json`
- `triggeredByCamp`: optional `attacker`, `defender`, or `both`
- `revealed`: optional boolean

Practical rule: only set `grantedStatusId` when the chosen `effect` needs a persistent status for runtime behavior or UI messaging.

## Safe Authoring Workflow

1. Edit [`configs/boss-encounter-templates.json`](../configs/boss-encounter-templates.json).
2. If you add or rename `skillId`, `grantedStatusId`, or `bossUnitTemplateId` references, update the canonical source file first:
   - battle skills or statuses: [`configs/battle-skills.json`](../configs/battle-skills.json)
   - unit templates: [`configs/units.json`](../configs/units.json)
3. If you add a new boss template for campaign content, update the mission's `bossTemplateId` reference only after the template validates.
4. Run the validator before opening a PR.

Validate the default shipped bundle:

```bash
npm run validate -- content-pack
```

Validate all shipped map-pack presets when the change should be treated as release-facing config breadth:

```bash
npm run validate -- content-pack:all
```

Write a machine-readable report for review notes or CI-like inspection:

```bash
npm run validate -- content-pack -- --report-path artifacts/release-readiness/content-pack-validation.json
```

## What The Validator Checks

`npm run validate -- content-pack` performs two layers that matter for boss encounter authoring:

- Document validation for shipped world, units, skills, map objects, and battle balance bundles
- Global authoring validation for hero skills, daily dungeons, equipment, and `bossTemplates`

Boss template failures appear in the authoring-validation section with `documentId` `bossTemplates`. The CLI prints the failing path and message directly, for example:

- duplicate template or phase ids
- first phase not starting at `hpThreshold: 1`
- thresholds not in descending order
- unknown battle skill, status, or unit template references
- invalid scripted ability timing or target values
- invalid blocker or trap field types

## Review Notes For PRs

For boss encounter template changes, the minimum reviewer-friendly note is usually:

- which template ids changed
- whether any campaign `bossTemplateId` references were added or updated
- which validation command you ran
- whether you generated a report artifact path

This keeps the PR aligned with [`docs/verification-matrix.md`](./verification-matrix.md) and the existing content-pack validation workflow.
