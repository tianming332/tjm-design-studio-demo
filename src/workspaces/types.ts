import type { ComponentType } from 'react';

/** A task-oriented workspace: swaps the right-side task panel and tool presets,
 *  while sharing the same document / layers / history as every other workspace. */
export interface Workspace {
  id: string;
  title: string;
  Panel: ComponentType;
}
