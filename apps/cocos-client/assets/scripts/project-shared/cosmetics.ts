import cosmeticsDocument from "../../../../../configs/cosmetics.json";
import shopRotationDocument from "../../../../../configs/shop-rotation.json";
import type {
  CosmeticCatalogConfig,
  CosmeticCategory,
  CosmeticDefinition,
  CosmeticInventory,
  CosmeticRarity,
  EquippedCosmetics,
  ShopRotation,
  ShopRotationConfig,
  ShopRotationEntry
} from "./models.ts";

const COSMETIC_CATEGORIES: CosmeticCategory[] = ["hero_skin", "unit_recolor", "profile_border", "battle_emote"];
const COSMETIC_RARITIES: CosmeticRarity[] = ["common", "rare", "epic", "legendary"];

function normalizeCosmeticCategory(value: unknown, fallback: CosmeticCategory): CosmeticCategory {
  return COSMETIC_CATEGORIES.includes(value as CosmeticCategory) ? (value as CosmeticCategory) : fallback;
}

function normalizeCosmeticRarity(value: unknown, fallback: CosmeticRarity): CosmeticRarity {
  return COSMETIC_RARITIES.includes(value as CosmeticRarity) ? (value as CosmeticRarity) : fallback;
}

export function normalizeCosmeticInventory(input?: Partial<CosmeticInventory> | null): CosmeticInventory {
  return {
    ownedIds: Array.from(
      new Set(
        (input?.ownedIds ?? [])
          .map((entry) => entry?.trim())
          .filter((entry): entry is string => Boolean(entry))
      )
    ).sort((left, right) => left.localeCompare(right))
  };
}

export function normalizeEquippedCosmetics(input?: Partial<EquippedCosmetics> | null): EquippedCosmetics {
  const heroSkinId = input?.heroSkinId?.trim();
  const unitRecolorId = input?.unitRecolorId?.trim();
  const profileBorderId = input?.profileBorderId?.trim();
  const battleEmoteId = input?.battleEmoteId?.trim();

  return {
    ...(heroSkinId ? { heroSkinId } : {}),
    ...(unitRecolorId ? { unitRecolorId } : {}),
    ...(profileBorderId ? { profileBorderId } : {}),
    ...(battleEmoteId ? { battleEmoteId } : {})
  };
}

export function normalizeCosmeticCatalogConfig(input?: Partial<CosmeticCatalogConfig> | null): CosmeticCatalogConfig {
  return {
    entries: (input?.entries ?? [])
      .filter((entry) => Boolean(entry && typeof entry === "object"))
      .map((entry, index) => {
        const id = entry.id?.trim() || `cosmetic-${index + 1}`;
        const name = entry.name?.trim() || id;
        return {
          id,
          name,
          category: normalizeCosmeticCategory(entry.category, "profile_border"),
          rarity: normalizeCosmeticRarity(entry.rarity, "common"),
          description: entry.description?.trim() || `${name} cosmetic`,
          price: Math.max(0, Math.floor(entry.price ?? 0)),
          unlockCondition: entry.unlockCondition?.trim() || "shop",
          ...(entry.previewAsset?.trim() ? { previewAsset: entry.previewAsset.trim() } : {})
        };
      })
  };
}

export function resolveCosmeticCatalog(): CosmeticDefinition[] {
  return normalizeCosmeticCatalogConfig(cosmeticsDocument as CosmeticCatalogConfig).entries;
}

function normalizeShopRotationEntry(entry: Partial<ShopRotationEntry>, fallbackSlotId: string, featured: boolean): ShopRotationEntry {
  return {
    slotId: entry.slotId?.trim() || fallbackSlotId,
    label: entry.label?.trim() || fallbackSlotId,
    featured,
    discountPercent: Math.max(0, Math.min(90, Math.floor(entry.discountPercent ?? 0))),
    ...(entry.category ? { category: normalizeCosmeticCategory(entry.category, "profile_border") } : {})
  };
}

function normalizeShopRotationConfig(input?: Partial<ShopRotationConfig> | null): ShopRotationConfig {
  const featuredSlots: ShopRotationEntry[] = (input?.featuredSlots ?? []).map((entry, index) =>
    normalizeShopRotationEntry(entry, `featured-${index + 1}`, true)
  );
  const discountSlots: ShopRotationEntry[] = (input?.discountSlots ?? []).map((entry, index) =>
    normalizeShopRotationEntry(entry, `discount-${index + 1}`, false)
  );

  return {
    featuredSlots,
    discountSlots
  };
}

function getIsoWeekParts(referenceDate = new Date()): { isoYear: number; isoWeek: number } {
  const date = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { isoYear, isoWeek };
}

function hashSeed(value: string): number {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function pickRotationCosmetics(entries: CosmeticDefinition[], slots: ShopRotationEntry[], seedPrefix: string): ShopRotationEntry[] {
  if (entries.length === 0) {
    return slots.map((slot) => ({ ...slot }));
  }

  const usedIds = new Set<string>();
  return slots.map((slot, index) => {
    const eligible = slot.category ? entries.filter((entry) => entry.category === slot.category) : entries;
    const pool = eligible.length > 0 ? eligible : entries;
    const offset = hashSeed(`${seedPrefix}:${slot.slotId}:${index}`) % pool.length;

    let selected = pool[offset];
    if (selected && usedIds.has(selected.id)) {
      selected = pool.find((candidate) => !usedIds.has(candidate.id)) ?? selected;
    }

    if (selected) {
      usedIds.add(selected.id);
    }

    return {
      ...slot,
      ...(selected ? { cosmeticId: selected.id } : {})
    };
  });
}

export function resolveWeeklyShopRotation(referenceDate = new Date()): ShopRotation {
  const config = normalizeShopRotationConfig(shopRotationDocument as ShopRotationConfig);
  const cosmetics = resolveCosmeticCatalog();
  const { isoYear, isoWeek } = getIsoWeekParts(referenceDate);
  const seed = `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;

  return {
    seed,
    weekLabel: `${isoYear} W${String(isoWeek).padStart(2, "0")}`,
    featuredSlots: pickRotationCosmetics(cosmetics, config.featuredSlots, `${seed}:featured`),
    discountSlots: pickRotationCosmetics(cosmetics, config.discountSlots, `${seed}:discount`)
  };
}
