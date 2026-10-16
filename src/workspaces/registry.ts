import type { Workspace } from './types';
import { EditPanel } from './edit/EditPanel';
import { PosterPanel } from './poster/PosterPanel';
import { PhotoPanel } from './photo/PhotoPanel';

export const WORKSPACES: Workspace[] = [
  { id: 'edit', title: '自由编辑', Panel: EditPanel },
  { id: 'poster', title: '海报排版', Panel: PosterPanel },
  { id: 'photo', title: '照片处理', Panel: PhotoPanel },
];

export function workspaceById(id: string): Workspace {
  return WORKSPACES.find((w) => w.id === id) ?? WORKSPACES[0];
}
