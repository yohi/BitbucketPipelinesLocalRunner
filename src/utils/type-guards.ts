import type { Step, ParallelSteps } from '../interfaces';

/**
 * Type guard utilities for pipeline items
 */

/**
 * アイテムがステップかどうかを判定
 */
export function isStep(item: any): item is Step {
  return item && typeof item === 'object' && item.script && !item.parallel;
}

/**
 * アイテムが並列ステップかどうかを判定
 */
export function isParallelSteps(item: any): item is ParallelSteps {
  return item && typeof item === 'object' && item.parallel;
}