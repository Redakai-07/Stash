'use client';

import * as React from 'react';
import { AlertTriangle, Download, Monitor, Moon, Shield, Sun, Trash2, Upload } from 'lucide-react';
import { exportFileName, exportVault, importVault, isValidBundle } from '@/db/repos/vault';
import { pluralize } from '@/lib/format';
import { useVaultStore } from '@/stores/vault-store';
import { useThemeStore, type ThemeMode } from '@/stores/theme-store';
import { Button } from '@/components/ui/button';
import { PageHeader, PageTitle, Section } from '@/components/ui/page';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

/**
 * Settings.
 *
 * Small on purpose. The two things that genuinely matter are stated plainly and
 * nothing else: your data is on this device, and you can take it out whenever
 * you want. Destructive actions live behind an explicit, described choice.
 */
export default function SettingsPage() {
  const folders = useVaultStore((state) => state.folders);
  const links = useVaultStore((state) => state.links);
  const refresh = useVaultStore((state) => state.refresh);
  const mode = useThemeStore((state) => state.mode);
  const setMode = useThemeStore((state) => state.setMode);

  const [busy, setBusy] = React.useState(false);
  const [confirmErase, setConfirmErase] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const activeLinks = links.filter((link) => !link.isArchived);
  const archived = links.length - activeLinks.length;
  const notes = activeLinks.filter((link) => link.userNote?.trim()).length;

  const handleExport = async () => {
    setBusy(true);
    try {
      const bundle = await exportVault();
      const name = exportFileName(new Date(bundle.exportedAt));
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });

      // Android browsers and the WebView can hand a File to the system share
      // sheet, which is how a user gets a backup into Drive or Files.
      const file = new File([blob], name, { type: 'application/json' });
      const canShareFiles =
        typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

      if (canShareFiles) {
        await navigator.share({ files: [file], title: name });
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
      toast('Export ready', { tone: 'success' });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      toast('Export failed', { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const handleImportFile = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (!isValidBundle(parsed)) {
        toast('That file is not a Stash export', { tone: 'danger' });
        return;
      }
      const result = await importVault(parsed, 'merge');
      await refresh();
      if (!result.ok) {
        toast(result.message ?? 'Import failed', { tone: 'danger' });
        return;
      }
      toast(
        `Imported ${pluralize(result.linksImported, 'link')} and ${pluralize(result.foldersImported, 'folder')}`,
        { tone: 'success' },
      );
    } catch {
      toast('Could not read that file', { tone: 'danger' });
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleErase = async () => {
    setBusy(true);
    const { eraseVault } = await import('@/db/repos/vault');
    await eraseVault();
    await refresh();
    setBusy(false);
    setConfirmErase(false);
    toast('Vault erased', { tone: 'success' });
  };

  return (
    <>
      <PageHeader>
        <PageTitle subtitle="Stored only on this device">Settings</PageTitle>
      </PageHeader>

      <Section title="Appearance">
        <div className="mx-4 rounded-2xl border border-border bg-surface p-1">
          <div className="flex gap-1">
            {THEME_OPTIONS.map((option) => {
              const OptionIcon = option.icon;
              const active = mode === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => void setMode(option.id)}
                  aria-pressed={active}
                  className={cn(
                    'tap flex flex-1 flex-col items-center gap-1 rounded-xl py-3 text-xs font-medium',
                    active ? 'bg-accent-soft text-accent' : 'text-muted active:bg-surface-2',
                  )}
                >
                  <OptionIcon size={18} strokeWidth={active ? 2.2 : 1.9} aria-hidden />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </Section>

      <Section title="Your vault">
        <div className="mx-4 overflow-hidden rounded-2xl border border-border bg-surface">
          <StatRow label="Saved links" value={pluralize(activeLinks.length, 'link')} />
          <StatRow label="With notes" value={pluralize(notes, 'link')} />
          <StatRow label="Folders" value={pluralize(folders.length, 'folder')} />
          <StatRow label="Archived" value={pluralize(archived, 'link')} last />
        </div>
        <p className="flex items-start gap-2 px-5 pt-2.5 text-xs leading-relaxed text-subtle">
          <Shield size={14} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
          Nothing here is uploaded. There is no account and no server, so the vault works exactly the same in
          airplane mode.
        </p>
      </Section>

      <Section title="Backup and restore">
        <div className="mx-4 flex flex-col gap-2">
          <Button variant="surface" className="justify-start" onClick={() => void handleExport()} disabled={busy}>
            <Download size={18} strokeWidth={1.9} aria-hidden />
            Export vault as JSON
          </Button>
          <Button
            variant="surface"
            className="justify-start"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            <Upload size={18} strokeWidth={1.9} aria-hidden />
            Import a Stash export
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImportFile(file);
            }}
          />
          <p className="px-1 text-xs leading-relaxed text-subtle">
            Import merges by default: items already in your vault are skipped, so running the same file twice
            never duplicates anything.
          </p>
        </div>
      </Section>

      <Section title="Danger zone" className="pb-10">
        <div className="mx-4 rounded-2xl border border-danger/30 bg-danger-soft p-4">
          <p className="text-[0.9375rem] font-semibold text-danger">Erase everything</p>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg/80">
            Deletes {pluralize(activeLinks.length, 'link')} and {pluralize(folders.length, 'folder')} from this
            device. Export first if you want a copy — this cannot be undone.
          </p>
          <div className="mt-3.5 flex items-center justify-between gap-3">
            <span className="text-[0.8125rem] font-medium text-fg">I understand this is permanent</span>
            <Switch
              checked={confirmErase}
              onCheckedChange={(value) => setConfirmErase(value)}
              aria-label="Confirm permanent erase"
            />
          </div>
          <Button
            variant="danger"
            className="mt-3 w-full"
            disabled={!confirmErase || busy}
            onClick={() => void handleErase()}
          >
            <Trash2 size={18} strokeWidth={2.1} aria-hidden />
            Erase vault
          </Button>
        </div>
      </Section>

      <div className="px-5 pb-8">
        <p className="flex items-center gap-1.5 text-xs text-subtle">
          <AlertTriangle size={13} strokeWidth={2} aria-hidden />
          Stash v0.1 · Phase 1 · offline link vault
        </p>
      </div>
    </>
  );
}

const THEME_OPTIONS: ReadonlyArray<{ id: ThemeMode; label: string; icon: typeof Sun }> = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
];

function StatRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between px-4 py-3 text-[0.9375rem]',
        !last && 'border-b border-border',
      )}
    >
      <span className="text-muted">{label}</span>
      <span className="font-medium text-fg">{value}</span>
    </div>
  );
}
