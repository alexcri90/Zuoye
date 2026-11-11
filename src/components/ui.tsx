import type { ReactNode } from 'react';

/** Chinese text: tagged as Simplified Chinese so the browser picks the right glyphs. */
export function Zh({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span lang="zh-Hans" className={`zh ${className}`.trim()}>
      {children}
    </span>
  );
}

/** The logo: a small vermilion seal. */
export function Seal() {
  return (
    <span className="seal" lang="zh-Hans" aria-hidden="true">
      作业
    </span>
  );
}

const TABS = [
  { id: 'home', href: '#/', icon: '练', label: 'Esercizi' },
  { id: 'lessons', href: '#/lessons', icon: '课', label: 'Lezioni' },
  { id: 'settings', href: '#/settings', icon: '设', label: 'Impostazioni' },
] as const;

export type TabId = (typeof TABS)[number]['id'];

export function TabBar({ current }: { current: TabId }) {
  return (
    <nav className="tabbar" aria-label="Sezioni">
      <div className="tabbar-inner">
        {TABS.map((tab) => (
          <a key={tab.id} className="tab" href={tab.href} aria-current={tab.id === current ? 'page' : undefined}>
            <Zh>{tab.icon}</Zh>
            <span>{tab.label}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <h1 className="page-title">{title}</h1>
      <span className="spacer" />
      {children}
    </header>
  );
}
