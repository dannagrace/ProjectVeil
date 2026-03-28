import { getDefaultUnitCatalog } from "./project-shared/world-config.ts";

export type BattlePanelUnitFaction = "crown" | "wild";
export type BattlePanelUnitRarity = "common" | "elite";
export type BattlePanelInteractionBadge = "battle";
export type BattlePanelPortraitState = "idle" | "selected" | "hit";

export interface BattlePanelUnitVisualDescriptor {
  templateId: string;
  faction: BattlePanelUnitFaction | null;
  rarity: BattlePanelUnitRarity;
  interaction: BattlePanelInteractionBadge;
  portraitState: BattlePanelPortraitState;
}

const unitTemplateById = new Map(getDefaultUnitCatalog().templates.map((template) => [template.id, template]));

export function resolveBattlePanelUnitVisual(
  templateId: string,
  options: {
    selected?: boolean;
    active?: boolean;
    damaged?: boolean;
  } = {}
): BattlePanelUnitVisualDescriptor {
  const template = unitTemplateById.get(templateId);
  const selected = options.selected === true || options.active === true;
  return {
    templateId,
    faction: template?.faction === "crown" || template?.faction === "wild" ? template.faction : null,
    rarity: template?.rarity === "elite" ? "elite" : "common",
    interaction: "battle",
    portraitState: selected ? "selected" : options.damaged === true ? "hit" : "idle"
  };
}
