export type ChannelLanguage = 'en' | 'hi';

const HI_MAP: Record<string, string> = {
  'Your shortlist:': 'आपका शॉर्टलिस्ट:',
  'Best match': 'सबसे बेहतर मिलान',
  'Effective price': 'प्रभावी कीमत',
  'Why this fits': 'यह आपके लिए सही है',
  'Why it fits': 'यह आपके लिए सही है',
  'Here is': 'यहां है',
  'Note': 'नोट',
  'Next sale': 'अगला सेल',
  'Review confidence': 'रिव्यू सटीकता',
  'Out of stock': 'रीस्टॉक',
};

export function detectLanguage(text: string): ChannelLanguage {
  return /[\u0900-\u097F]/.test(text) ? 'hi' : 'en';
}

export function translateReply(text: string, language: ChannelLanguage): string {
  if (language !== 'hi') return text;
  let result = text;
  for (const [from, to] of Object.entries(HI_MAP)) result = result.replace(from, to);
  return result;
}
