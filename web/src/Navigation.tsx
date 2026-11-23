import { NavLink, useLocation } from 'react-router-dom';
import { ALL_PAGES, NAV_GROUPS, groupForPath } from './nav';
import { Icon, type IconName } from './brand';

const sectionIcons: Record<string, IconName> = { autopilot: 'compass', 'trader-joe': 'message', 'smart-portfolio': 'pie', settings: 'settings' };

export function PrimaryNav() {
  const current = groupForPath(useLocation().pathname);
  return <nav className="mia-primary-nav" aria-label="Main">
    {NAV_GROUPS.map((group) => <NavLink key={group.id} to={group.pages[0].to} end
      className={current?.id === group.id ? 'active' : undefined}
      aria-current={current?.id === group.id ? 'page' : undefined}>
      <Icon name={sectionIcons[group.id] ?? 'compass'} size={17} />
      <span>{group.label}</span>
    </NavLink>)}
  </nav>;
}
/**
 * Secondary tools remain directly accessible without cluttering the four
 * top-level destinations. Derived from the existing page catalogue: no
 * duplicate screen registrations or hidden workspaces.
 */
export function GroupTabs() {
  const loc = useLocation();
  const group = groupForPath(loc.pathname);
  if (!group) return null;
  const tools = ALL_PAGES.filter((page) =>
    !group.pages.some((primary) => primary.to === page.to) &&
    groupForPath(page.to)?.id === group.id,
  );
  if (!tools.length) return null;
  return <details className="section-tools">
    <summary>Explore {group.label} tools <span className="hint">({tools.length})</span></summary>
    <nav className="section-tool-links" aria-label={`${group.label} tools`}>
      {tools.map((page) => <NavLink key={page.to} to={page.to} title={page.desc}>{page.label}</NavLink>)}
    </nav>
  </details>;
}
