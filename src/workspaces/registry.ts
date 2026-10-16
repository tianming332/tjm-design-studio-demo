import type { Workspace } from './types';
import { EditPanel } from './edit/EditPanel';
import { PosterPanel } from './poster/PosterPanel';
import { PhotoPanel } from './photo/PhotoPanel';
import { TouchDrawPanel, TouchEditPanel } from './touch/TouchPanels';

export const WORKSPACES: Workspace[] = [
  { id: 'edit', title: '自由编辑', Panel: EditPanel },
  { id: 'poster', title: '海报排版', Panel: PosterPanel },
  { id: 'photo', title: '照片处理', Panel: PhotoPanel },
  { id: 'touchDraw', title: '触摸绘图', Panel: TouchDrawPanel },
  { id: 'touchEdit', title: '触摸编辑', Panel: TouchEditPanel },
];

export function workspaceById(id: string): Workspace {
  return WORKSPACES.find((w) => w.id === id) ?? WORKSPACES[0];
}
