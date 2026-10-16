import { LayoutDashboard, Activity, GitPullRequestArrow, Boxes, ShieldCheck, FlaskConical, Settings, ChartNoAxesCombined } from 'lucide-react';
export const NAV = [
  { group: 'Monitor', items: [
    { href: '/', label: 'Overview', icon: LayoutDashboard },
    { href: '/traffic', label: 'Live traffic', icon: Activity },
    { href: '/heals', label: 'Drift events', icon: GitPullRequestArrow },
    { href: '/metrics', label: 'Metrics & traces', icon: ChartNoAxesCombined },
  ] },
  { group: 'Registry', items: [{ href: '/apis', label: 'APIs', icon: Boxes }] },
  { group: 'Trust', items: [{ href: '/audit', label: 'Audit chain', icon: ShieldCheck }] },
  { group: 'Develop', items: [{ href: '/playground', label: 'Playground', icon: FlaskConical }] },
  { group: 'System', items: [{ href: '/settings', label: 'Settings', icon: Settings }] },
];
