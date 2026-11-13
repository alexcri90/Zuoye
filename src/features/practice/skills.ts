import type { Skill } from '../../lib/schema.ts';

export interface SkillInfo {
  /** One character used as the icon. */
  icon: string;
  title: string;
  hint: string;
}

export const SKILL_INFO: Record<Skill, SkillInfo> = {
  pinyin: { icon: '拼', title: 'Pinyin', hint: 'Leggi il carattere, scrivi il pinyin' },
  write: { icon: '写', title: 'Scrittura', hint: 'Scrivi il carattere tratto per tratto' },
  'it-zh': { icon: '译', title: 'Italiano → cinese', hint: 'Traduci la frase in caratteri' },
  'zh-it': { icon: '读', title: 'Cinese → italiano', hint: 'Traduci la frase in italiano' },
  cloze: { icon: '填', title: 'Completa la frase', hint: 'Scegli la parola che manca' },
  order: { icon: '序', title: 'Riordina', hint: 'Metti le parole in ordine' },
};

/** Exercise types that are implemented, in the order shown on the home screen. */
export const ENABLED_SKILLS: readonly Skill[] = ['pinyin', 'write', 'cloze', 'order', 'it-zh', 'zh-it'];
