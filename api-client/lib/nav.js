<<<<<<< HEAD
import { LayoutDashboard, Activity, GitPullRequestArrow, Boxes, ShieldCheck, FlaskConical, Settings, ChartNoAxesCombined } from 'lucide-react';
=======
<<<<<<< HEAD
import { LayoutDashboard, Activity, GitPullRequestArrow, Boxes, ShieldCheck, FlaskConical, Settings, ChartNoAxesCombined } from 'lucide-react';
=======
import { LayoutDashboard, Activity, GitPullRequestArrow, Boxes, ShieldCheck, FlaskConical, Settings } from 'lucide-react';
>>>>>>> origin/main
>>>>>>> origin/main
export const NAV = [
  { group: 'Monitor', items: [
    { href: '/', label: 'Overview', icon: LayoutDashboard },
    { href: '/traffic', label: 'Live traffic', icon: Activity },
    { href: '/heals', label: 'Drift events', icon: GitPullRequestArrow },
<<<<<<< HEAD
    { href: '/metrics', label: 'Metrics & traces', icon: ChartNoAxesCombined },
=======
<<<<<<< HEAD
    { href: '/metrics', label: 'Metrics & traces', icon: ChartNoAxesCombined },
=======
>>>>>>> origin/main
>>>>>>> origin/main
  ] },
  { group: 'Registry', items: [{ href: '/apis', label: 'APIs', icon: Boxes }] },
  { group: 'Trust', items: [{ href: '/audit', label: 'Audit chain', icon: ShieldCheck }] },
  { group: 'Develop', items: [{ href: '/playground', label: 'Playground', icon: FlaskConical }] },
  { group: 'System', items: [{ href: '/settings', label: 'Settings', icon: Settings }] },
];
