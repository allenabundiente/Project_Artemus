// The royal wardrobe: avatar customization catalog.
//
// Every part ships a FREE default plus paid upgrades (shop SKUs). Layers
// composite back-to-front: cape → body → armor → hair → helmet.
//
// Art comes from sprite PNGs rendered from grids: `avatar_<part>_<set>_<sex>_<frame>`
// (e.g. avatar_hair_long_female_idle). Each part takes the chosen `color` via
// the chroma recolor in the compositor (frontend/src/game/avatar.ts).

export type AvatarPart = 'hair' | 'armor' | 'helmet' | 'cape';

export interface AvatarSetDef {
  id: string;
  name: string;
  /** Shop SKU that unlocks this set (both sexes, one purchase). */
  sku: string;
  price: number;
  description: string;
}

export const HAIR_SETS: AvatarSetDef[] = [
  { id: 'short',   name: 'Squire Cut',   sku: 'hair_short',   price: 0,  description: 'Close-cropped and battle-ready. Free to all heroes.' },
  { id: 'topknot', name: 'Warrior Knot', sku: 'hair_topknot', price: 0,  description: 'Tied high for war. A free classic of the northern clans.' },
  { id: 'long',    name: 'Court Locks',  sku: 'hair_long',    price: 40, description: 'Flowing locks that catch the torchlight.' },
];

export const ARMOR_SETS: AvatarSetDef[] = [
  { id: 'tunic',   name: 'Traveler Tunic', sku: 'armor_tunic',   price: 0,  description: 'Simple, honest cloth. Free to all heroes.' },
  { id: 'leather', name: 'Ranger Leather', sku: 'armor_leather', price: 0,  description: 'Boiled leather, supple and quiet. Free to all heroes.' },
  { id: 'plate',   name: 'Knight Plate',   sku: 'armor_plate',   price: 90, description: 'Full steel. Heavy, gleaming, reassuring.' },
];

export const HELMET_SETS: AvatarSetDef[] = [
  { id: 'none',    name: 'Bare Head',    sku: 'helmet_none',   price: 0,  description: 'Let them see your face. Free to all heroes.' },
  { id: 'kettle',  name: 'Kettle Helm',  sku: 'helmet_kettle', price: 0,  description: 'A broad-brimmed helm of the common soldiery. Free to all heroes.' },
  { id: 'great',   name: 'Great Helm',   sku: 'helmet_great',  price: 80, description: 'Full-face steel. Feared in the lists.' },
];

export const CAPE_SETS: AvatarSetDef[] = [
  { id: 'none',  name: 'No Cape',   sku: 'cape_none',  price: 0,  description: 'Travel light. Free to all heroes.' },
  { id: 'cloth', name: 'Cloth Cape', sku: 'cape_cloth', price: 0,  description: 'A plain wool cape against the dungeon chill. Free to all heroes.' },
  { id: 'silk',  name: 'Silk Cape',  sku: 'cape_silk',  price: 55, description: 'Merchant-priced finery that catches every torch.' },
];

/** Everything an avatar is made of, for shop seeding and validation. */
export const ALL_SETS: Record<AvatarPart, AvatarSetDef[]> = {
  hair: HAIR_SETS,
  armor: ARMOR_SETS,
  helmet: HELMET_SETS,
  cape: CAPE_SETS,
};

export function findSet(part: AvatarPart, id: string): AvatarSetDef | undefined {
  return ALL_SETS[part].find((s) => s.id === id);
}

/** Which owned SKUs unlock which sets, flattened for the client. */
export function setsForSkus(ownedSkus: string[]): Record<AvatarPart, string[]> {
  const has = new Set(ownedSkus);
  const pick = (list: AvatarSetDef[]) => list.filter((s) => s.price === 0 || has.has(s.sku)).map((s) => s.id);
  return {
    hair: pick(HAIR_SETS),
    armor: pick(ARMOR_SETS),
    helmet: pick(HELMET_SETS),
    cape: pick(CAPE_SETS),
  };
}

/** Seed the shop with the wardrobe catalog (idempotent, run at boot). */
export function seedWardrobeItems() {
  const label: Record<AvatarPart, string> = { hair: 'Hair', armor: 'Armor', helmet: 'Helmet', cape: 'Cape' };
  return (Object.keys(ALL_SETS) as AvatarPart[]).flatMap((part) =>
    ALL_SETS[part]
      .filter((s) => s.price > 0)
      .map((s) => ({
        sku: s.sku,
        name: `${s.name} (${label[part]})`,
        description: s.description,
        category: part,
        kind: `${part}:${s.id}`,
        price: s.price,
        sort: 1,
      })),
  );
}

/** Themed color swatches for the wardrobe picker (heraldic palette). */
export const WARDROBE_COLORS: { hex: string; name: string }[] = [
  { hex: '#e8b43c', name: 'Heraldic Gold' },
  { hex: '#a82a2a', name: 'Crusader Red' },
  { hex: '#3f5d3a', name: 'Ranger Green' },
  { hex: '#7fb3cb', name: 'Steel Blue' },
  { hex: '#8b5a2b', name: 'Wood Brown' },
  { hex: '#f2e8d5', name: 'Parchment' },
  { hex: '#4f2a25', name: 'Dungeon Brick' },
  { hex: '#9dd1ff', name: 'Mythril' },
  { hex: '#2a1f2e', name: 'Midnight' },
  { hex: '#d97d2b', name: 'Torch Orange' },
  { hex: '#6f9c3d', name: 'Goblin Green' },
  { hex: '#c95d7a', name: 'Banner Rose' },
];
