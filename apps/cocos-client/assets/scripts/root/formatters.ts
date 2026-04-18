export function formatHeroStatBonus(bonus: { attack: number; defense: number; power: number; knowledge: number }): string {
  return [
    bonus.attack > 0 ? `攻击 +${bonus.attack}` : "",
    bonus.defense > 0 ? `防御 +${bonus.defense}` : "",
    bonus.power > 0 ? `力量 +${bonus.power}` : "",
    bonus.knowledge > 0 ? `知识 +${bonus.knowledge}` : ""
  ]
    .filter(Boolean)
    .join(" / ");
}

export function formatResourceKindLabel(kind: "gold" | "wood" | "ore"): string {
  return kind === "gold" ? "金币" : kind === "wood" ? "木材" : "矿石";
}

export function formatUpgradeCostLabel(cost: { gold: number; wood: number; ore: number }): string {
  return [`金币 ${cost.gold}`, `木材 ${cost.wood}`, `矿石 ${cost.ore}`].join(" / ");
}
