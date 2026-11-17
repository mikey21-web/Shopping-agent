/**
 * The shoe subtypes.
 *
 * Kept in its own module because both the category profile and the
 * scoring components need it, and a cycle between those two would make
 * the initialisation order depend on which file was imported first.
 */

/**
 * The shoe categories, and what each one is actually for.
 *
 * `cushioning`, `support`, `grip` and `breathability` are the properties
 * that separate them. A running shoe is not a gym shoe with a logo on it:
 * running needs longitudinal cushioning and a rocker, gym needs a flat
 * stable base for lateral movement, hiking needs aggressive grip and a
 * stiff upper.
 */
export const SHOE_TYPES = {
  running: {
    label: 'Running shoes',
    description: 'Forward-motion sport. Needs cushioning for repeated heel strike.',
    priorities: { cushioning: 1, support: 0.9, weight: 0.8, grip: 0.7, durability: 0.6 },
  },
  walking: {
    label: 'Walking shoes',
    description: 'Long hours of upright walking. Needs comfort and support over distance.',
    priorities: { comfort: 1, support: 0.9, cushioning: 0.8, weight: 0.7, durability: 0.6 },
  },
  gym: {
    label: 'Gym / training shoes',
    description: 'Lateral movement and lifting. Needs a flat, stable base.',
    priorities: { grip: 1, support: 0.9, weight: 0.7, cushioning: 0.6, durability: 0.5 },
  },
  casual: {
    label: 'Casual sneakers',
    description: 'Everyday wear. Needs comfort, looks and durability.',
    priorities: { comfort: 0.9, durability: 0.9, style: 0.8, weight: 0.6, cushioning: 0.6 },
  },
  formal: {
    label: 'Formal shoes',
    description: 'Work and occasion wear. Needs to look right and last.',
    priorities: { style: 1, durability: 0.9, comfort: 0.7, material: 0.8, grip: 0.4 },
  },
  sports: {
    label: 'Sports-specific shoes',
    description: 'A single sport. Needs the traction and support that sport demands.',
    priorities: { grip: 1, support: 0.9, weight: 0.7, durability: 0.6, cushioning: 0.6 },
  },
  hiking: {
    label: 'Hiking / outdoor shoes',
    description: 'Rough ground and weather. Needs grip, a protective upper and water resistance.',
    priorities: { grip: 1, material: 0.9, support: 0.8, durability: 0.9, waterResistance: 0.8 },
  },
} as const;

/** The shoe type keys. */
export type ShoeType = keyof typeof SHOE_TYPES;

/** The sub-type of a shoe, read from the product's own description. */
export const SHOE_TYPE_KEYS = Object.keys(SHOE_TYPES) as ShoeType[];

/**
 * Read the intended use from free text.
 *
 * Running is checked after the other sport-like types, because "trail
 * running shoes" must land on running rather than hiking — the trail is
 * where they are run, not the sport.
 */
export function detectShoeType(text: string): ShoeType | null {
  const lower = text.toLowerCase();

  const rules: { type: ShoeType; patterns: RegExp[] }[] = [
    {
      // "Running" is unambiguous. A trail running shoe is a running
      // shoe; only "trail" on its own means hiking.
      type: 'running',
      patterns: [
        /\brunning\b/,
        /\bjogging\b/,
        /\btreadmill\b/,
        /\bmarathon\b/,
        /\b5k\b|\b10k\b|\bhalf marathon\b/,
      ],
    },
    {
      type: 'hiking',
      patterns: [
        /\bhiking\b/,
        /\btrekking\b/,
        /\btrail\b/,
        /\boutdoor\b/,
        /\bwaterproof\b/,
        /\bcamping\b/,
      ],
    },
    {
      type: 'gym',
      patterns: [
        /\bgym\b/,
        /\btraining\b/,
        /\bgymnasium\b/,
        /\bcrossfit\b/,
        /\blifting\b/,
        /\bworkout\b/,
      ],
    },
    {
      type: 'sports',
      patterns: [
        /\bcricket\b/,
        /\bfootball\b|\bsoccer\b/,
        /\bbasketball\b/,
        /\btennis\b/,
        /\bvolleyball\b/,
        /\bbadminton\b/,
        /\bkhado\b/,
      ],
    },
    {
      type: 'walking',
      patterns: [/\bwalking\b/, /\bcomfort(?:able)? shoes?\b/, /\bwalks?\b/],
    },
    {
      type: 'formal',
      patterns: [
        /\bformal\b/,
        /\boxford\b/,
        /\bderby\b/,
        /\bloafer\b/,
        /\bmonk strap\b/,
        /\bdress shoes?\b/,
        /\boffice shoes?\b/,
        /\bleather shoes?\b/,
      ],
    },
    {
      type: 'casual',
      patterns: [
        /\bcasual\b/,
        /\b everyday\b/,
        /\bstreetwear\b/,
        /\bsneakers?\b/,
        /\bcanvas\b/,
      ],
    },
  ];

  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      if (pattern.test(lower)) return rule.type;
    }
  }

  return null;
}
