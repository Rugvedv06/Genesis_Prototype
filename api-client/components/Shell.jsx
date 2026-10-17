'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV } from '../lib/nav';
import { useStore } from '../lib/store';
import { Pill, HashChip } from './ui';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';

function Connection({ conn }) {
  const map = { live: ['live', 'Live'], connecting: ['drift', 'Connecting'], reconnecting: ['drift', 'Reconnecting'], offline: ['bad', 'Core offline'] };
  const [tone, label] = map[conn] ?? map.offline;
  return <Pill tone={tone}>{label}</Pill>;
}

export default function Shell({ children }) {
  const path = usePathname();
  const { conn, audit, apis } = useStore();
  const { theme, setTheme } = useTheme();
  if (path === '/landing') return <>{children}<Toaster position="bottom-right" richColors /></>;
  const active = (href) => (href === '/' ? path === '/' : path.startsWith(href));
  const crumb = NAV.flatMap((g) => g.items).find((i) => active(i.href) && (i.href !== '/' || path === '/'))?.label ?? 'healr';
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">h</span><span>healr</span></div>
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.items.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className="nav-item" title={label} aria-current={active(href) ? 'page' : undefined}><Icon size={15} aria-hidden /><span>{label}</span></Link>
            ))}
          </div>
        ))}
        <div className="sidebar-foot">{apis.length} API{apis.length === 1 ? '' : 's'} connected</div>
      </aside>
      <div className="main">
        <div className="topbar">
          <span className="crumbs"><b>{crumb}</b></span>
          <span className="grow" />
          {audit?.headHash && (
            <span className="hidden items-center gap-2 text-[11px] text-muted-foreground md:flex" title="Head of the hash chained audit log">
              chain head <HashChip hash={audit.headHash} />
            </span>
          )}
          <Connection conn={conn} />
          <Button variant="ghost" size="icon-sm" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title="Toggle color theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </div>
        <main className="page">{children}</main>
      </div>
      <Toaster position="bottom-right" richColors />
    </div>
  );
}
