import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { NAV_GROUPS, groupForPath, type NavGroup } from './nav';

/** Four primary operator destinations; legacy views remain accessible by URL and command search. */
const store = { get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable: preference not kept */ } } };

export function SideNav({ collapsed }: { collapsed: boolean }) {
  const loc = useLocation(); const current = groupForPath(loc.pathname);
  const [open, setOpen] = useState<Record<string, boolean>>(() => store.get('mia-nav-open', {} as Record<string, boolean>));
  // The group holding the current page always opens, so the current selection is never hidden.
  useEffect(() => { if (current && !open[current.id]) setOpen((o) => ({ ...o, [current.id]: true })); }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => store.set('mia-nav-open', open), [open]);
  return <nav className="nav" aria-label="Main">
    {NAV_GROUPS.map((g) => g.pages.length === 1
      ? <NavLink key={g.id} to={g.pages[0].to} end className={({ isActive }) => `navgroup-link${isActive || current?.id === g.id ? ' active' : ''}`} title={g.desc}><span className="ic" aria-hidden>{g.icon}</span><span className="lbl">{g.label}</span></NavLink>
      : <Group key={g.id} g={g} active={current?.id === g.id} expanded={!collapsed && !!open[g.id]} collapsed={collapsed} onToggle={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))} />)}
  </nav>;
}

function Group({ g, active, expanded, collapsed, onToggle }: { g: NavGroup; active: boolean; expanded: boolean; collapsed: boolean; onToggle: () => void }) {
  const listId = `nav-${g.id}`;
  // In the icon rail a group is a link to its first page (no flyout to get lost in); expanded, it is a disclosure button.
  if (collapsed) return <NavLink to={g.pages[0].to} className={`navgroup-link${active ? ' active' : ''}`} title={`${g.label} — ${g.desc}`} aria-label={g.label}><span className="ic" aria-hidden>{g.icon}</span></NavLink>;
  return <div className={`navgroup${active ? ' current' : ''}`}>
    <button type="button" className="navgroup-btn" aria-expanded={expanded} aria-controls={listId} onClick={onToggle} title={g.desc}>
      <span className="ic" aria-hidden>{g.icon}</span><span className="lbl">{g.label}</span><span className="chev" aria-hidden>{expanded ? '▾' : '▸'}</span>
    </button>
    <ul id={listId} className="subnav" hidden={!expanded}>
      {g.pages.map((p) => <li key={p.to}><NavLink to={p.to} title={p.desc}><span className="lbl">{p.label}</span></NavLink></li>)}
    </ul>
  </div>;
}

/** Sibling pages of the current group, as tabs under the top bar: one tap between related screens on any device. */
export function GroupTabs() {
  const loc = useLocation(); const g = groupForPath(loc.pathname);
  if (!g || g.pages.length < 2) return null;
  return <nav className="grouptabs" aria-label={`${g.label} pages`}>
    <span className="grouptabs-title" aria-hidden>{g.icon} {g.label}</span>
    {g.pages.map((p) => <NavLink key={p.to} to={p.to} title={p.desc}>{p.label}</NavLink>)}
  </nav>;
}

/** Mobile: four destinations plus "More" (opens the full menu). The operating-mode badge stays in the top bar. */
export function MobileNav({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const loc = useLocation(); const cur = groupForPath(loc.pathname)?.id;
  const items = NAV_GROUPS;
  return <nav className="mobnav" aria-label="Mobile">
    {items.map((g) => <NavLink key={g.id} to={g.pages[0].to} end className={cur === g.id ? 'active' : undefined} aria-current={cur === g.id ? 'page' : undefined}><span aria-hidden>{g.icon}</span>{g.label}</NavLink>)}
    <button type="button" className={moreOpen ? 'active' : undefined} onClick={onMore} aria-expanded={moreOpen} aria-label="More pages"><span aria-hidden>☰</span>More</button>
  </nav>;
}
