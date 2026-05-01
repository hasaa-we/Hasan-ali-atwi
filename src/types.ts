export const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'ar', name: 'Arabic', flag: '🇸🇦', dialects: ['Modern Standard Arabic (Fusha)', 'Egyptian', 'Gulf'] },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
];

export const VOICES = [
  { id: 'achernar', name: 'Achernar (Male)', gender: 'male' },
  { id: 'achird', name: 'Achird (Female)', gender: 'female' },
  { id: 'algenib', name: 'Algenib (Male)', gender: 'male' },
  { id: 'algieba', name: 'Algieba (Female)', gender: 'female' },
];

export const DUBBING_STYLES = [
  { id: 'neutral', name: 'Neutral' },
  { id: 'dramatic', name: 'Dramatic' },
];

export enum AppStatus {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  READY_TO_DUB = 'READY_TO_DUB',
  SYNTHESIZING = 'SYNTHESIZING',
  EXPORTING = 'EXPORTING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

export interface DubSegment {
  id: string;
  startTime: number;
  endTime: number;
  originalText: string;
  translatedText: string;
  speakerLabel: string;
  audioUrl?: string;
  isSynthesizing?: boolean;
}

export interface LanguageOption {
  code: string;
  name: string;
  flag: string;
  dialects?: string[];
}

export interface SpeakerMap {
  [speakerLabel: string]: string;
}
