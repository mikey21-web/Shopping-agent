/**
 * Category registry.
 *
 * Importing this module registers every category profile. A new category is
 * added by writing a profile and calling `registerCategory` — the engine
 * (matching, pricing, review analysis, recommendations) reads from the
 * registry and needs no change.
 */

import {
  registerCategory,
  listCategories,
  getCategory,
  detectCategoryFromText,
  categoryExists,
  type CategoryProfile,
  type ComponentDefinition,
  type ScoreInput,
} from './types.ts';
import {
  audioProfile,
  cameraProfile,
  laptopProfile,
  smartphoneProfile,
  smartwatchProfile,
  tvProfile,
} from './electronics.ts';
import {
  applianceProfile,
  beautyProfile,
  fashionProfile,
  furnitureProfile,
  groceryProfile,
} from './lifestyle.ts';
import { automotiveProfile } from './automotive.ts';
import { shoesProfile } from './shoes.ts';
import { GENERIC_COMPONENTS } from '../recommendations/components.ts';

/**
 * Every profile the platform ships with.
 *
 * Adding a category means adding one entry here. Nothing else in the
 * platform needs to change.
 */
const PROFILES: CategoryProfile[] = [
  smartphoneProfile,
  laptopProfile,
  tvProfile,
  audioProfile,
  smartwatchProfile,
  cameraProfile,
  applianceProfile,
  furnitureProfile,
  fashionProfile,
  beautyProfile,
  groceryProfile,
  automotiveProfile,
  shoesProfile,
];

for (const profile of PROFILES) registerCategory(profile);

export type { ComponentDefinition, ScoreInput };
export { shoesProfile, SHOE_TYPES, detectShoeType, SHOE_TYPE_KEYS } from './shoes.ts';
export type { ShoeType } from './shoes.ts';

export {
  registerCategory,
  listCategories,
  getCategory,
  detectCategoryFromText,
  categoryExists,
  type CategoryProfile,
};

/**
 * The scoring components for a category.
 *
 * A category with a bespoke scoring model returns its own components and
 * `specialised: true`. A category without one falls back to the generic
 * component set and `specialised: false`, so the caller can tell the user
 * that the ranking for this category is a general one rather than a
 * purpose-built one.
 */
export function componentsForCategory(categoryId: string | null | undefined): {
  components: CategoryProfile['components'];
  specialised: boolean;
} {
  const profile = getCategory(categoryId);
  if (profile && profile.components.length > 0) {
    return { components: profile.components, specialised: true };
  }
  return { components: GENERIC_COMPONENTS, specialised: false };
}

/**
 * The fields that define a distinct sellable variant in a category.
 *
 * Two listings that differ on one of these are different products, not the
 * same product listed twice.
 */
export function variantFieldsForCategory(categoryId: string | null | undefined): string[] {
  const profile = getCategory(categoryId);
  return profile?.variantFields ?? [];
}
