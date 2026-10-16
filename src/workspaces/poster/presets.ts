export interface SizePreset { id: string; label: string; width: number; height: number }

export const PRESETS: SizePreset[] = [
  { id: 'a4p', label: 'A4 竖 2480×3508', width: 2480, height: 3508 },
  { id: 'square', label: '社媒方图 1080×1080', width: 1080, height: 1080 },
  { id: 'story', label: '竖图 1080×1920', width: 1080, height: 1920 },
  { id: 'banner', label: '横幅 1200×628', width: 1200, height: 628 },
];
