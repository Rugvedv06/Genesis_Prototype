'use client';
import { useState } from 'react';
import { Check, Copy, CircleDot, ShieldAlert, Wrench, ArrowRightLeft, Zap, X, CircleAlert } from 'lucide-react';
import { OUTCOME, describeOp, opSource } from '../lib/labels';
import { Button } from '@/components/ui/button';
import { Card as ShadCard, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton as ShadSkeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs as ShadTabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const ICON = { inflight: CircleDot, passthrough: Check, healed: Wrench, cache: Zap, rejected: ArrowRightLeft, halted: ShieldAlert, failed: CircleAlert };

export function OutcomePill({ outcome }) {
  const o = OUTCOME[outcome] ?? OUTCOME.failed; const Icon = ICON[outcome] ?? CircleAlert;
  return <span className="pill" data-tone={o.tone} title={o.hint}><Icon size={12} aria-hidden />{o.label}</span>;
}

export function Pill({ tone, children, icon: Icon }) {
  return <span className="pill" data-tone={tone ?? 'dim'}>{Icon && <Icon size={12} aria-hidden />}{children}</span>;
}

export function PageHeader({ title, purpose, actions }) {
  return (
    <header className="page-head">
      <div className="grow"><h1>{title}</h1>{purpose && <p>{purpose}</p>}</div>
      {actions && <div className="page-actions flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

// Solid card with an optional header row. `flush` renders children without body padding (for tables).
export function Card({ title, right, children, flush, className }) {
  return (
    <ShadCard className={className}>
      {(title || right) && (
        <CardHeader className="border-b border-border pb-3">
          <div className="flex w-full items-center gap-2">
            <CardTitle className="grow text-[13px] font-semibold">{title}</CardTitle>
            {right}
          </div>
        </CardHeader>
      )}
      {flush ? <div className="min-w-0">{children}</div> : <CardContent className="min-w-0">{children}</CardContent>}
    </ShadCard>
  );
}

export function StatTile({ label, value, hint, tone, icon: Icon }) {
  return (
    <ShadCard className="py-4">
      <CardContent className="px-4 py-0">
        <div className="tile-label">{Icon && <Icon size={14} aria-hidden style={{ color: tone ? `var(--${tone})` : undefined }} />}{label}</div>
        <div className="tile-value" style={{ color: tone ? `var(--${tone})` : undefined }}>{value}</div>
        {hint && <div className="tile-hint">{hint}</div>}
      </CardContent>
    </ShadCard>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="empty">
      {Icon && <div className="empty-icon"><Icon size={20} aria-hidden /></div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

export function PageLoading({ label = 'Loading data' }) {
  return <div className="page-state" role="status"><span className="state-indicator state-pending" />{label}</div>;
}

export function PageError({ error, onRetry, label = 'Could not load this page' }) {
  return <div className="page-error" role="alert"><div><strong>{label}</strong><p>{error?.message ?? 'The core service could not be reached.'}</p></div>{onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>}</div>;
}

export function CodeBlock({ value, label }) {
  return <pre className="code" aria-label={label}>{typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)}</pre>;
}

export function Field({ label, hint, children }) {
  return <label className="form-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export const Skeleton = ({ h = 14, w = '100%' }) => <ShadSkeleton className="block" style={{ height: h, width: w }} />;

export function ErrorState({ error, onRetry, what = 'data' }) {
  return (
    <EmptyState icon={CircleAlert} title={`Could not load ${what}`} action={onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}>
      {error?.message ?? 'Unknown error'}. Check that healr core is running at the URL shown in Settings.
    </EmptyState>
  );
}

export function OpChip({ op }) {
  const src = opSource(op);
  return <span className="chip" data-op={op.op} title={`${describeOp(op)}${src ? ` (source: ${src})` : ''}`}>{op.op}</span>;
}

export function HashChip({ hash, n = 8 }) {
  const [done, setDone] = useState(false);
  if (!hash) return <span className="faint mono">none</span>;
  return (
    <button className="chip" title={hash} onClick={() => { navigator.clipboard?.writeText(hash); setDone(true); setTimeout(() => setDone(false), 1200); }}>
      {hash.slice(0, n)}{done ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

// Right-side drawer, built on shadcn Sheet. Escape and backdrop close it natively.
export function Drawer({ open, onClose, title, children }) {
  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-[min(560px,100vw)] gap-0 border-l border-border-strong bg-popover p-0 sm:max-w-[min(560px,100vw)]">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="text-[14px] font-semibold">{title}</SheetTitle>
        </SheetHeader>
        <div className="grow overflow-auto p-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

// Centered modal, built on shadcn Dialog.
export function Modal({ open, onClose, title, children, actions, wide = false }) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="gap-3 border border-border-strong bg-popover"
        style={wide ? { width: 'min(920px, calc(100vw - 2rem))', maxWidth: 'calc(100vw - 2rem)' } : undefined}
      >
        <DialogHeader>
          <DialogTitle className="text-[14px] font-semibold">{title}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">{children}</div>
        <DialogFooter className="gap-2">{actions}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Underline-style tab bar. Content is rendered by the caller based on `value`.
export function Tabs({ tabs, value, onChange }) {
  return (
    <ShadTabs value={value} onValueChange={onChange}>
      <TabsList variant="line" className="h-auto w-full min-w-0 max-w-full justify-start gap-1 overflow-x-auto overflow-y-hidden border-b border-border bg-transparent p-0">
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id} className="min-w-max shrink-0 rounded-none border-b-2 border-transparent px-3 py-2 text-[13px] data-[selected]:border-brand data-[selected]:text-foreground">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </ShadTabs>
  );
}

export { Button, Badge, X };
