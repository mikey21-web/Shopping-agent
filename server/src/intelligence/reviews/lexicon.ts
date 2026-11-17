/**
 * Aspect lexicon for review mining.
 *
 * Real Indian marketplace reviews are frequently a mix of English, Hindi
 * (Devanagari) and Hinglish (romanised Hindi), often all in one sentence.
 * The lexicon therefore has three layers for every aspect:
 *
 *   en       — English phrases
 *   hi       — Devanagari phrases
 *   hinglish — romanised Hindi / code-mixed phrases
 *
 * Phrases are matched on word boundaries where practical. Each match carries
 * a polarity so a review can mention the same aspect positively and negatively.
 */

import type { ReviewAspect } from '../../domain/types.ts';

export interface AspectPhrase {
  /** Phrase text (already lowercase). */
  phrase: string;
  /** -1 negative, +1 positive. */
  polarity: -1 | 1;
  /** Weights confidence of the match. */
  strength: number;
}

export interface AspectLexiconEntry {
  aspect: ReviewAspect;
  negative: AspectPhrase[];
  positive: AspectPhrase[];
}

function p(phrase: string, polarity: -1 | 1, strength = 1): AspectPhrase {
  return { phrase, polarity, strength };
}

export const ASPECT_LEXICON: AspectLexiconEntry[] = [
  {
    aspect: 'battery',
    negative: [
      p('battery drain', -1, 1.2),
      p('battery life is bad', -1, 1.2),
      p('battery backup is poor', -1, 1.2),
      p('poor battery life', -1, 1.2),
      p('short battery life', -1, 1.1),
      p('bad battery life', -1, 1.2),
      p('dies quickly', -1, 1),
      p('drains quickly', -1, 1.1),
      p('battery health degraded', -1, 1.3),
      p('battery degraded', -1, 1.2),
      p('battery backup is bad', -1, 1.1),
      p('battery is not good', -1, 1),
      p('charging very slow', -1, 0.9),
      p('takes long to charge', -1, 0.9),
      p('बैटरी बहुत कम', -1, 1.2),
      p('बैटरी कम हो जाती', -1, 1.2),
      p('बैटरी बैड है', -1, 1.1),
      p('बैटरी ड्रेन', -1, 1.1),
      p('बैटरी लाइफ कम', -1, 1.1),
      p('battery jaldi khatam', -1, 1.1),
      p('battery backup kam', -1, 1.1),
      p('battery toot jati hai', -1, 1.1),
    ],
    positive: [
      p('long battery life', 1, 1.2),
      p('great battery life', 1, 1.2),
      p('excellent battery', 1, 1.1),
      p('good battery life', 1, 1.1),
      p('all day battery', 1, 1.2),
      p('battery lasts all day', 1, 1.2),
      p('battery backup is good', 1, 1.1),
      p('battery backup bahut achha', 1, 1.1),
      p('बैटरी बहुत बढ़िया', 1, 1.2),
      p('बैटरी लाइफ अच्छी', 1, 1.1),
      p('बैटरी बढ़िया है', 1, 1.1),
      p('battery mast hai', 1, 1.1),
      p('battery backup bahut accha', 1, 1.1),
    ],
  },
  {
    aspect: 'heating',
    negative: [
      p('overheating', -1, 1.3),
      p('over heating', -1, 1.2),
      p('heats up', -1, 1.1),
      p('heating issue', -1, 1.2),
      p('heat issue', -1, 1.1),
      p('gets hot', -1, 1),
      p('very hot', -1, 1.1),
      p('thermal throttling', -1, 1.3),
      p('gaming heat', -1, 1),
      p('गर्म हो जाता', -1, 1.2),
      p('गर्म हो जाती है', -1, 1.2),
      p('heating problem', -1, 1.2),
      p('heating bahut zyada', -1, 1.2),
      p('bahut garam', -1, 1.1),
      p('garam ho jaata', -1, 1.1),
    ],
    positive: [
      p('no heating issue', 1, 1.2),
      p('stays cool', 1, 1.1),
      p('cooling is good', 1, 1),
      p('no overheating', 1, 1.2),
      p('cooling is excellent', 1, 1),
      p('ठंडा रहता है', 1, 1.1),
      p('heating problem nahi', 1, 1.1),
      p('cooling bahut achha', 1, 1.1),
    ],
  },
  {
    aspect: 'camera',
    negative: [
      p('blurry', -1, 1.1),
      p('low light performance', -1, 1.2),
      p('bad camera', -1, 1.2),
      p('poor camera', -1, 1.2),
      p('camera is not good', -1, 1.1),
      p('focus issue', -1, 1),
      p('noisy photos', -1, 1),
      p('camera is average', -1, 1.1),
      p('photos are not sharp', -1, 1.1),
      p('front camera is bad', -1, 1.1),
      p('कैमरा अच्छा नहीं', -1, 1.1),
      p('फोटो ब्लर', -1, 1.1),
      p('camera bakwas', -1, 1.1),
      p('camera theek thaak', -1, 1),
    ],
    positive: [
      p('excellent camera', 1, 1.2),
      p('great camera', 1, 1.2),
      p('amazing camera', 1, 1.2),
      p('good camera', 1, 1.1),
      p('beautiful photos', 1, 1.1),
      p('sharp images', 1, 1.1),
      p('camera is awesome', 1, 1.1),
      p('कैमरा बहुत बढ़िया', 1, 1.2),
      p('कैमरा शानदार', 1, 1.2),
      p('photos mast', 1, 1),
      p('camera bahut mast', 1, 1.1),
    ],
  },
  {
    aspect: 'performance',
    negative: [
      p('lags a lot', -1, 1.2),
      p('very laggy', -1, 1.2),
      p('laggy', -1, 1.1),
      p('it lags', -1, 1.1),
      p('freezes', -1, 1.2),
      p('keeps freezing', -1, 1.2),
      p('slow performance', -1, 1.1),
      p('crashes', -1, 1.2),
      p('restarts itself', -1, 1.2),
      p('buffering', -1, 1),
      p('not smooth', -1, 1.1),
      p('hangs', -1, 1),
      p('लैग करता है', -1, 1.2),
      p('hang कर जाता', -1, 1.2),
      p('bahut slow', -1, 1.1),
      p('lag macha deta', -1, 1.1),
    ],
    positive: [
      p('very smooth', 1, 1.2),
      p('smooth performance', 1, 1.2),
      p('fast and smooth', 1, 1.2),
      p('no lag', 1, 1.2),
      p('snappy', 1, 1.1),
      p('blazing fast', 1, 1.2),
      p('multitasking is great', 1, 1.1),
      p('smooth chalata hai', 1, 1.1),
      p('बहुत स्मूथ', 1, 1.2),
      p('performance mast', 1, 1.1),
      p('speed bahut achhi', 1, 1.1),
    ],
  },
  {
    aspect: 'build_quality',
    negative: [
      p('cheap build', -1, 1.2),
      p('poor build quality', -1, 1.2),
      p('build quality is bad', -1, 1.2),
      p('feels cheap', -1, 1.1),
      p('all plastic', -1, 1.1),
      p('flexes', -1, 1),
      p('creaks', -1, 1),
      p('broke within', -1, 1.2),
      p('looks cheap', -1, 0.9),
      p('बिल्ड क्वालिटी खराब', -1, 1.1),
      p('सस्ता लगता है', -1, 1),
      p('build quality bakwas', -1, 1.1),
    ],
    positive: [
      p('premium build', 1, 1.2),
      p('solid build quality', 1, 1.2),
      p('great build quality', 1, 1.2),
      p('sturdy', 1, 1),
      p('premium feel', 1, 1.1),
      p('build quality is excellent', 1, 1.2),
      p('बिल्ड क्वालिटी बहुत अच्छी', 1, 1.1),
      p('premium build mast', 1, 1.1),
    ],
  },
  {
    aspect: 'software',
    negative: [
      p('software bugs', -1, 1.2),
      p('lots of bugs', -1, 1.2),
      p('buggy', -1, 1.1),
      p('bloatware', -1, 1.2),
      p('software issues', -1, 1.1),
      p('update issues', -1, 1.1),
      p('no updates', -1, 1.2),
      p('software is poor', -1, 1.1),
      p('ui is slow', -1, 0.9),
      p('सॉफ्टवेयर में बग', -1, 1.1),
      p('बहुत सारे बग', -1, 1.1),
      p('update nahi milta', -1, 1.1),
    ],
    positive: [
      p('clean software', 1, 1.1),
      p('smooth ui', 1, 1),
      p('regular updates', 1, 1.2),
      p('software is excellent', 1, 1.1),
      p('no bloatware', 1, 1.2),
      p('software अच्छा', 1, 1),
      p('updates milte rehte hain', 1, 1.1),
    ],
  },
  {
    aspect: 'durability',
    negative: [
      p('stopped working', -1, 1.3),
      p('stopped working after', -1, 1.3),
      p('died after', -1, 1.3),
      p('defective', -1, 1.2),
      p('returned it', -1, 1.1),
      p('dead after', -1, 1.2),
      p('motherboard issue', -1, 1.3),
      p('display issue after', -1, 1.2),
      p('bandh ho gaya', -1, 1.2),
      p('kaam nahi kar raha', -1, 1.1),
      p('मर गया', -1, 1.2),
      p('बंद हो गया', -1, 1.1),
      p('within months it died', -1, 1.3),
    ],
    positive: [
      p('still working fine', 1, 1.3),
      p('still going strong', 1, 1.2),
      p('working fine after', 1, 1.2),
      p('lasted well', 1, 1.1),
      p('no issues in months', 1, 1.1),
      p('अभी तक चल रहा है', 1, 1.2),
      p('abhi bhi chal raha', 1, 1.2),
      p('still perfectly fine', 1, 1.2),
    ],
  },
  {
    aspect: 'service',
    negative: [
      p('customer service', -1, 0.8),
      p('no response from customer care', -1, 1.2),
      p('worst customer service', -1, 1.2),
      p('service center', -1, 0.8),
      p('warranty claim', -1, 1),
      p('warranty rejected', -1, 1.2),
      p('refund not received', -1, 1.3),
      p('warranty issue', -1, 1.1),
      p('poor service', -1, 1.1),
      p('service centre', -1, 0.8),
      p('कस्टमर केयर', -1, 0.9),
      p('वारंटी नहीं मिली', -1, 1.1),
      p('service bahut kharab', -1, 1.1),
    ],
    positive: [
      p('quick service', 1, 1.1),
      p('warranty honored', 1, 1.2),
      p('excellent customer service', 1, 1.2),
      p('resolved quickly', 1, 1.1),
      p('good customer care', 1, 1.1),
      p('service mast', 1, 1),
      p('कस्टमर केयर अच्छा', 1, 1),
    ],
  },
  {
    aspect: 'value',
    negative: [
      p('not worth the price', -1, 1.2),
      p('overpriced', -1, 1.2),
      p('not worth buying', -1, 1.2),
      p('costly for what you get', -1, 1.2),
      p('waste of money', -1, 1.3),
      p('paisa waste', -1, 1.2),
      p('value for money nahi', -1, 1),
      p('paisa barbaad', -1, 1.2),
    ],
    positive: [
      p('value for money', 1, 1.2),
      p('worth the price', 1, 1.2),
      p('good value for money', 1, 1.2),
      p('best value', 1, 1.1),
      p('paisa vasool', 1, 1.2),
      p('value for money hai', 1, 1.1),
    ],
  },
  {
    aspect: 'storage',
    negative: [
      p('storage is not enough', -1, 1.1),
      p('low storage', -1, 1),
      p('storage full ho jata', -1, 1.1),
      p('no expandable storage', -1, 1),
    ],
    positive: [
      p('plenty of storage', 1, 1.1),
      p('expandable storage', 1, 1.1),
      p('storage is sufficient', 1, 1),
    ],
  },
  {
    aspect: 'network',
    negative: [
      p('network issue', -1, 1.2),
      p('no network', -1, 1.2),
      p('signal strength is poor', -1, 1.2),
      p('network problems', -1, 1.1),
      p('calls drop', -1, 1.1),
      p('network bahut kharab', -1, 1.1),
    ],
    positive: [
      p('network is good', 1, 1),
      p('5g works great', 1, 1.1),
      p('signal strength is excellent', 1, 1.2),
      p('calls are clear', 1, 1),
    ],
  },
  {
    aspect: 'audio',
    negative: [
      p('speaker is loud but distorted', -1, 1.1),
      p('sound quality is poor', -1, 1.2),
      p('volume is very low', -1, 1.1),
      p('speaker is bad', -1, 1.1),
      p('audio bahut kamzor', -1, 1.1),
    ],
    positive: [
      p('sound quality is excellent', 1, 1.2),
      p('great speakers', 1, 1.1),
      p('loud and clear', 1, 1.1),
      p('audio bahut achha', 1, 1.1),
    ],
  },
  {
    aspect: 'design',
    negative: [
      p('design is boring', -1, 0.9),
      p('bulky', -1, 0.9),
      p('too heavy', -1, 0.9),
      p('looks cheap', -1, 0.9),
    ],
    positive: [
      p('beautiful design', 1, 1.1),
      p('sleek design', 1, 1.1),
      p('looks premium', 1, 1),
      p('design is nice', 1, 1),
    ],
  },
  {
    aspect: 'compatibility',
    negative: [
      p('not compatible', -1, 1.1),
      p('pairing issue', -1, 1.1),
      p('does not work with', -1, 1.1),
      p('connectivity issue', -1, 1.1),
    ],
    positive: [
      p('works perfectly with', 1, 1.1),
      p('pairs instantly', 1, 1),
      p('compatible with all', 1, 1),
    ],
  },
  {
    aspect: 'comfort',
    negative: [
      p('uncomfortable', -1, 1.2),
      p('not comfortable', -1, 1.1),
      p('causes ear pain', -1, 1.2),
      p('tight fit', -1, 1.1),
      p('clamping force', -1, 1),
      p('it hurts after', -1, 1.1),
      p('bahut uncomfortable', -1, 1.1),
      p('comfortable nahi', -1, 1.1),
    ],
    positive: [
      p('very comfortable', 1, 1.2),
      p('comfortable for long hours', 1, 1.2),
      p('fits perfectly', 1, 1.1),
      p('lightweight and comfortable', 1, 1.1),
      p('bahut comfortable', 1, 1.1),
    ],
  },
  {
    aspect: 'fit',
    negative: [
      p('runs small', -1, 1.2),
      p('runs large', -1, 1.2),
      p('size is wrong', -1, 1.1),
      p('size chart is wrong', -1, 1.2),
      p('too tight', -1, 1.1),
      p('too loose', -1, 1),
    ],
    positive: [
      p('true to size', 1, 1.2),
      p('perfect fit', 1, 1.2),
      p('size chart is accurate', 1, 1.1),
      p('fits well', 1, 1.1),
    ],
  },
  {
    aspect: 'noise_cancellation',
    negative: [
      p('anc is weak', -1, 1.2),
      p('noise cancelling is not effective', -1, 1.2),
      p('can hear the noise', -1, 1.1),
      p('anc is not worth it', -1, 1.1),
      p('wind noise', -1, 1),
    ],
    positive: [
      p('excellent anc', 1, 1.2),
      p('noise cancellation is great', 1, 1.2),
      p('blocks all the noise', 1, 1.2),
      p('anc is very good', 1, 1.1),
    ],
  },
  {
    aspect: 'running_cost',
    negative: [
      p('consumes a lot of electricity', -1, 1.2),
      p('high electricity bill', -1, 1.2),
      p('uses too much power', -1, 1.1),
      p('bijli bill bahut aata', -1, 1.1),
    ],
    positive: [
      p('very energy efficient', 1, 1.2),
      p('low power consumption', 1, 1.2),
      p('5 star rating', 1, 1),
      p('bijli bill kam', 1, 1.1),
    ],
  },
  {
    aspect: 'authenticity',
    negative: [
      p('looks fake', -1, 1.3),
      p('duplicate product', -1, 1.3),
      p('not original', -1, 1.3),
      p('refilled', -1, 1.2),
      p('fake product', -1, 1.3),
    ],
    positive: [
      p('genuine product', 1, 1.3),
      p('authentic', 1, 1.2),
      p('original packaging', 1, 1.2),
      p('has the batch code', 1, 1.2),
    ],
  },
  {
    aspect: 'safety',
    negative: [
      p('unsafe', -1, 1.4),
      p('hazard', -1, 1.4),
      p('it sparked', -1, 1.4),
      p('recall', -1, 1.4),
      p('caused a burn', -1, 1.4),
      p('leaked', -1, 1.3),
    ],
    positive: [
      p('ISI certified', 1, 1.3),
      p('safe to use', 1, 1.2),
      p('no leakage', 1, 1.2),
    ],
  },
  {
    aspect: 'noise',
    negative: [
      p('very noisy', -1, 1.2),
      p('loud noise', -1, 1.1),
      p('fan noise is loud', -1, 1.2),
      p('noisy operation', -1, 1.1),
    ],
    positive: [
      p('very quiet', 1, 1.2),
      p('silent operation', 1, 1.2),
      p('fan noise is negligible', 1, 1.1),
    ],
  },
  {
    aspect: 'cleaning',
    negative: [
      p('does not clean properly', -1, 1.2),
      p('poor wash quality', -1, 1.2),
      p('leaves stains', -1, 1.2),
      p('dhulai nahi hoti', -1, 1.1),
    ],
    positive: [
      p('cleans very well', 1, 1.2),
      p('wash quality is excellent', 1, 1.2),
      p('removes tough stains', 1, 1.2),
      p('dhulai achhi hoti hai', 1, 1.1),
    ],
  },
  {
    aspect: 'freshness',
    negative: [
      p('not fresh', -1, 1.2),
      p('stale', -1, 1.2),
      p('expiring soon', -1, 1.3),
      p('expired', -1, 1.4),
      p('leaking packet', -1, 1.3),
    ],
    positive: [
      p('very fresh', 1, 1.2),
      p('good expiry date', 1, 1.2),
      p('long shelf life', 1, 1.2),
      p('packed properly', 1, 1.1),
    ],
  },
  {
    aspect: 'accuracy',
    negative: [
      p('reading is inaccurate', -1, 1.2),
      p('wrong reading', -1, 1.2),
      p('sensor is inaccurate', -1, 1.2),
    ],
    positive: [
      p('accurate reading', 1, 1.2),
      p('sensor is precise', 1, 1.2),
      p('matches my other devices', 1, 1.1),
    ],
  },
];

/** Phrases that often appear in incentivised or campaign reviews. */
export const INCENTIVE_PHRASES: string[] = [
  'voucher',
  'cashback offer',
  'super saver deal',
  'great Indian festival',
  'big billion days',
  'prime day',
  'first time user',
  'new user',
  'win prize',
  'lucky winner',
  'inr',
  'discount coupon',
  'price drop',
  'best deal ever',
  'must buy',
  'best in class',
  'highly recommended',
  'just go for it',
  'best money ever spent',
  'best purchase i ever made',
  'perfect product',
  'best product in india',
  'dhandha',
  'sasta aur accha',
  'best in this budget',
];

/** Words that suggest the reviewer is describing long-term ownership. */
export const LONG_TERM_MARKERS: string[] = [
  'after 6 months',
  'after 1 year',
  'after one year',
  'after a year',
  '6 months',
  'one year',
  '2 years',
  'two years',
  'long term',
  'long-term',
  'since last year',
  'after months',
  'daily use',
  'daily driver',
  'still using',
  'abhi bhi use',
  '6 महीने',
  'एक साल',
];

/** Words that suggest a first-impressions review. */
export const SHORT_TERM_MARKERS: string[] = [
  'day 1',
  'first day',
  'just received',
  'just bought',
  'unboxing',
  'delivery',
  'first impression',
  'abhi mila',
  'abhi aaya',
];
