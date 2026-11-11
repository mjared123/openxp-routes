/**
 * Levels and experience.
 *
 * WoW Forever uses Classic's numbers: the same XP per level and the same
 * quest XP table. Dungeons are the exception (see DUNGEON_KILL_XP).
 */

/** XP to go from level L to L+1, at index L. */
export const XP_TO_NEXT = [
  0, 400, 900, 1400, 2100, 2800, 3600, 4500, 5400, 6500, 7600, 8800, 10100, 11400, 12900, 14400, 16000, 17700, 19400, 21300, 23200, 25200, 27300,
  29400, 31700, 34000, 36400, 38900, 41400, 44300, 47400, 50800, 54500, 58600, 62800, 67100, 71600, 76100, 80800, 85700, 90700, 95800, 101000,
  106300, 111800, 117500, 123200, 129100, 135100, 141200, 147500, 153900, 160400, 167100, 173900, 180800, 187900, 195000, 202300, 209800,
];
export const MAX_LEVEL = 60;
export const QUEST_LOG_LIMIT = 20;
/** Forever moved dungeon XP from the mobs to the quests: kills inside pay roughly this share of Classic's. */
export const DUNGEON_KILL_XP = 0.36;

/** Total XP at a level; the level can have a fraction. */
export function xpAtLevel(level: number): number {
  const whole = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
  let total = 0;
  for (let l = 1; l < whole; l++) total += XP_TO_NEXT[l]!;
  if (whole < MAX_LEVEL) total += (level - whole) * XP_TO_NEXT[whole]!;
  return total;
}

/** The level, with a fraction, for a total XP. */
export function levelOf(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= XP_TO_NEXT[level]!) {
    xp -= XP_TO_NEXT[level]!;
    level++;
  }
  return level < MAX_LEVEL ? level + xp / XP_TO_NEXT[level]! : MAX_LEVEL;
}

/** A guess at a quest's XP when the data has none. */
export function estimateQuestXp(questLevel: number): number {
  const level = Math.max(1, questLevel);
  return level >= 12 ? Math.max(150, 110 * level - 1000) : 40 * level + 100;
}

/** XP for turning in a quest at a level: full until the quest is 6 levels below you, then less. */
export function questXp(base: number | undefined, questLevel: number, level: number): number {
  if (level >= MAX_LEVEL) return 0;
  const xp = base || estimateQuestXp(questLevel);
  const gap = Math.floor(level) - questLevel;
  if (questLevel <= 0 || gap <= 5) return xp;
  return Math.round(xp * ({ 6: 0.8, 7: 0.6, 8: 0.4, 9: 0.2 }[gap] ?? 0.1));
}

function zeroDifference(level: number): number {
  for (const [top, zd] of [[7, 5], [9, 6], [11, 7], [15, 8], [19, 9], [29, 11], [39, 12], [44, 13], [49, 14], [54, 15], [59, 16]] as const) {
    if (level <= top) return zd;
  }
  return 17;
}

/** XP for killing one normal mob. */
export function mobXp(mobLevel: number, level: number): number {
  level = Math.floor(level);
  if (level >= MAX_LEVEL) return 0;
  const base = 5 * level + 45;
  if (mobLevel >= level) return base * (1 + 0.05 * Math.min(mobLevel - level, 4));
  return Math.max(0, base * (1 - (level - mobLevel) / zeroDifference(level)));
}

export type Difficulty = "gray" | "green" | "yellow" | "orange" | "red";

/** The colour the game gives a quest of a level in your quest log. */
export function difficulty(questLevel: number, level: number): Difficulty {
  level = Math.floor(level);
  if (questLevel <= 0) return "yellow";
  if (questLevel >= level + 5) return "red";
  if (questLevel >= level + 3) return "orange";
  if (questLevel >= level - 2) return "yellow";
  const gray = level <= 5 ? 0 : level <= 39 ? level - Math.floor(level / 10) - 5 : level - Math.floor(level / 5) - 1;
  return questLevel <= gray ? "gray" : "green";
}
