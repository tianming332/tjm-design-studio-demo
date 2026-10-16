import { Icon } from './Icon';
import type { ReactNode } from 'react';

export function PanelIntro({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return <header className="panel-intro"><div><Icon name={icon} size={18} /><h2>{title}</h2></div><p>{children}</p></header>;
}
