'use client';

import * as React from 'react';
import {
  Archive,
  ArrowLeft,
  ArrowUpDown,
  Check,
  FolderInput,
  FolderPlus,
  Pencil,
  Star,
  Trash2,
} from 'lucide-react';
import type { Folder } from '@/db/types';
import { FOLDER_ICON_CHOICES, Icon } from '@/components/ui/icon';
import { canMoveFolder, folderPathLabel, type MoveCheck } from '@/lib/tree';
import { pluralize } from '@/lib/format';
import { useBackDismiss } from '@/hooks/use-back-dismiss';
import { useVaultStore } from '@/stores/vault-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { FolderDestinationList } from '@/components/capture/folder-destination-list';
import { CreateFolderInline } from '@/components/capture/create-folder-inline';
import { INBOX_DESTINATION, folderDestination } from '@/lib/destination';

/**
 * Folder management.
 *
 * Deleting a folder is the one genuinely destructive action in the product, so
 * it never happens as a side effect: the sheet states exactly what is inside,
 * offers "move contents up" as the default, and requires an explicit choice
 * before anything is removed.
 */

type Mode = 'actions' | 'rename' | 'move' | 'delete' | 'subfolder';

export interface FolderActionsSheetProps {
  folder: Folder | null;
  onClose: () => void;
  /** Called after a successful delete so callers can leave the folder view. */
  onDeleted?: (folderId: string) => void;
}

export function FolderActionsSheet({ folder, onClose, onDeleted }: FolderActionsSheetProps) {
  const folders = useVaultStore((state) => state.folders);
  const links = useVaultStore((state) => state.links);
  // Reset by remount: callers pass a `key` derived from the folder id.
  const [mode, setMode] = React.useState<Mode>('actions');
  const [name, setName] = React.useState(folder?.name ?? '');
  const [icon, setIcon] = React.useState<string>(folder?.icon ?? 'folder');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const close = React.useCallback(() => {
    setMode('actions');
    onClose();
  }, [onClose]);

  useBackDismiss(Boolean(folder), close);

  const impact = React.useMemo(() => {
    if (!folder) return null;
    const descendants = new Set<string>();
    const queue = [folder.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const candidate of folders) {
        if (candidate.parentId === current && !descendants.has(candidate.id)) {
          descendants.add(candidate.id);
          queue.push(candidate.id);
        }
      }
    }
    const direct = links.filter((link) => !link.isArchived && link.folderId === folder.id).length;
    const nested = links.filter(
      (link) => !link.isArchived && link.folderId !== null && descendants.has(link.folderId),
    ).length;
    return { descendants: descendants.size, direct, nested, total: direct + nested };
  }, [folder, folders, links]);

  if (!folder) return null;

  const parentLabel = folder.parentId ? folderPathLabel(folders, folder.parentId) : 'Top level';
  const moveCheck: MoveCheck = canMoveFolder(folders, folder.id, folder.parentId);

  /**
   * Archiving is the gentle alternative to deleting: nothing leaves the vault,
   * the links simply stop showing up in the folder. Scoped to this folder's own
   * subtree so a parent folder is never touched by a child's action.
   */
  const archiveFolderAndContents = async () => {
    setBusy(true);
    const subtreeIds = new Set<string>([folder.id]);
    for (const candidate of folders) {
      if (candidate.parentId === folder.id) subtreeIds.add(candidate.id);
    }
    const targets = links.filter(
      (link) => !link.isArchived && link.folderId !== null && subtreeIds.has(link.folderId),
    );
    for (const link of targets) {
      await useVaultStore.getState().archiveLink(link.id, true);
    }
    setBusy(false);
    toast(targets.length > 0 ? `Archived ${pluralize(targets.length, 'link')}` : 'Nothing to archive');
    close();
  };

  const handleRename = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Give the folder a name.');
      return;
    }
    setBusy(true);
    const ok = await useVaultStore.getState().renameFolder(folder.id, trimmed);
    if (!ok) {
      setBusy(false);
      setError('Another folder here already uses that name.');
      return;
    }
    if (icon !== (folder.icon ?? 'folder')) {
      await useVaultStore.getState().setFolderEmojiIcon(folder.id, icon);
    }
    setBusy(false);
    toast('Folder updated', { tone: 'success' });
    close();
  };

  const handleMove = async (targetParentId: string | null) => {
    setBusy(true);
    const result = await useVaultStore.getState().moveFolder(folder.id, targetParentId);
    setBusy(false);
    if (!result.ok) {
      toast(result.reason, { tone: 'danger' });
      return;
    }
    toast('Folder moved', { tone: 'success' });
    close();
  };

  const handleDelete = async (strategy: 'move-contents-up' | 'delete-everything') => {
    setBusy(true);
    const ok = await useVaultStore.getState().deleteFolder(folder.id, strategy);
    setBusy(false);
    if (!ok) {
      toast('Could not delete that folder', { tone: 'danger' });
      return;
    }
    toast(strategy === 'move-contents-up' ? 'Folder removed, contents kept' : 'Folder and contents deleted', {
      tone: strategy === 'move-contents-up' ? 'success' : 'default',
    });
    onDeleted?.(folder.id);
    close();
  };

  return (
    <Sheet open onOpenChange={(next) => !next && close()}>
      <SheetContent>
        <SheetHeader>
          <div className="flex items-start gap-3">
            {mode !== 'actions' ? (
              <button
                type="button"
                onClick={() => {
                  setMode('actions');
                  setError(null);
                }}
                aria-label="Back"
                className="tap -ml-1.5 flex size-9 shrink-0 items-center justify-center rounded-full text-accent active:bg-surface-2"
              >
                <ArrowLeft size={19} strokeWidth={2.1} aria-hidden />
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate">
                {mode === 'rename'
                  ? 'Rename folder'
                  : mode === 'move'
                    ? 'Move folder'
                    : mode === 'delete'
                      ? 'Delete folder?'
                      : mode === 'subfolder'
                        ? 'New subfolder'
                        : folder.name}
              </SheetTitle>
              <p className="mt-0.5 truncate text-xs text-subtle">
                {mode === 'actions' ? `${parentLabel} · ${pluralize(impact?.total ?? 0, 'link')}` : folderPathLabel(folders, folder.id)}
              </p>
            </div>
          </div>
        </SheetHeader>

        <SheetBody>
          {mode === 'subfolder' ? (
            <CreateFolderInline
              folders={folders}
              defaultParentId={folder.id}
              onCancel={() => setMode('actions')}
              onCreated={(created) => {
                toast(`Created “${created.name}”`, { tone: 'success' });
                close();
              }}
            />
          ) : mode === 'rename' ? (
            <div className="flex flex-col gap-3 px-3 pb-2">
              <div className="flex items-center gap-2">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
                  <Icon name={icon} size={20} strokeWidth={1.9} />
                </span>
                <Input
                  value={name}
                  autoFocus
                  onChange={(event) => {
                    setName(event.target.value);
                    setError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleRename();
                    }
                  }}
                  aria-label="Folder name"
                  enterKeyHint="done"
                  maxLength={80}
                />
              </div>
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 no-scrollbar" role="radiogroup" aria-label="Folder icon">
                {FOLDER_ICON_CHOICES.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    role="radio"
                    aria-checked={icon === choice}
                    aria-label={choice}
                    onClick={() => setIcon(choice)}
                    className={cn(
                      'tap flex size-9 shrink-0 items-center justify-center rounded-xl border',
                      icon === choice
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-border bg-surface-2 text-subtle',
                    )}
                  >
                    <Icon name={choice} size={16} strokeWidth={1.9} />
                  </button>
                ))}
              </div>
              {error ? (
                <p className="rounded-lg bg-danger-soft px-3 py-2 text-[0.8125rem] text-danger">{error}</p>
              ) : null}
            </div>
          ) : mode === 'move' ? (
            <FolderDestinationList
              folders={folders}
              selection={folder.parentId ? folderDestination(folder.parentId) : INBOX_DESTINATION}
              onSelect={(selection) => void handleMove(selection.kind === 'folder' ? selection.folderId : null)}
              showInbox
              filterPlaceholder="Find a destination"
            />
          ) : mode === 'delete' ? (
            <div className="flex flex-col gap-3 px-3 pb-2">
              <div className="rounded-xl border border-border bg-surface-2 p-3.5">
                <p className="text-[0.9375rem] font-semibold text-fg">“{folder.name}” contains</p>
                <ul className="mt-2 flex flex-col gap-1 text-[0.8125rem] text-muted">
                  <li>· {pluralize(impact?.direct ?? 0, 'link')} directly in this folder</li>
                  <li>· {pluralize(impact?.nested ?? 0, 'link')} in its subfolders</li>
                  <li>· {pluralize(impact?.descendants ?? 0, 'subfolder')}</li>
                </ul>
              </div>

              <div className="flex flex-col gap-2">
                <ChoiceCard
                  title="Delete the folder, keep the links"
                  description={`Links move to ${parentLabel} and stay in your vault.`}
                  recommended
                  onClick={() => void handleDelete('move-contents-up')}
                  disabled={busy}
                />
                <ChoiceCard
                  title="Delete everything inside"
                  description={`${pluralize(impact?.total ?? 0, 'link')} and ${pluralize(impact?.descendants ?? 0, 'subfolder')} are removed permanently.`}
                  destructive
                  onClick={() => void handleDelete('delete-everything')}
                  disabled={busy}
                />
                <Button variant="ghost" className="w-full" onClick={() => setMode('actions')} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 px-3 pb-2">
              <ActionRow
                icon={<Pencil size={18} strokeWidth={1.9} aria-hidden />}
                label="Rename or change icon"
                onClick={() => setMode('rename')}
              />
              <ActionRow
                icon={<FolderPlus size={18} strokeWidth={1.9} aria-hidden />}
                label={`New folder inside “${folder.name}”`}
                onClick={() => setMode('subfolder')}
              />
              <ActionRow
                icon={<FolderInput size={18} strokeWidth={1.9} aria-hidden />}
                label="Move to another folder"
                onClick={() => setMode('move')}
              />
              <ActionRow
                icon={
                  <Star
                    size={18}
                    strokeWidth={1.9}
                    className={cn(folder.isFavorite && 'fill-warning text-warning')}
                    aria-hidden
                  />
                }
                label={folder.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                onClick={() => {
                  void useVaultStore.getState().toggleFolderFavorite(folder.id);
                  close();
                }}
              />
              <ActionRow
                icon={<ArrowUpDown size={18} strokeWidth={1.9} aria-hidden />}
                label="Move up in this list"
                onClick={() => {
                  void useVaultStore
                    .getState()
                    .reorderFolder(folder.id, 'up')
                    .then((ok) => toast(ok ? 'Moved up' : 'Already at the top'));
                }}
              />
              <ActionRow
                icon={<ArrowUpDown size={18} strokeWidth={1.9} className="rotate-180" aria-hidden />}
                label="Move down in this list"
                onClick={() => {
                  void useVaultStore
                    .getState()
                    .reorderFolder(folder.id, 'down')
                    .then((ok) => toast(ok ? 'Moved down' : 'Already at the bottom'));
                }}
              />
              <ActionRow
                icon={<Archive size={18} strokeWidth={1.9} aria-hidden />}
                label="Archive the links inside"
                onClick={() => void archiveFolderAndContents()}
              />
              <ActionRow
                icon={<Trash2 size={18} strokeWidth={1.9} aria-hidden />}
                label="Delete folder"
                tone="danger"
                onClick={() => setMode('delete')}
              />
              {!moveCheck.ok ? <p className="px-1 text-xs text-subtle">{moveCheck.reason}</p> : null}
            </div>
          )}
        </SheetBody>

        {mode === 'rename' ? (
          <SheetFooter>
            <Button variant="primary" size="lg" className="w-full" onClick={() => void handleRename()} disabled={busy}>
              <Check size={18} strokeWidth={2.4} aria-hidden />
              Save changes
            </Button>
          </SheetFooter>
        ) : mode === 'actions' ? (
          <SheetFooter>
            <Button variant="surface" className="w-full" onClick={close}>
              Close
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ActionRow({
  icon,
  label,
  onClick,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'tap flex w-full items-center gap-3 rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-left active:bg-surface-3',
        tone === 'danger' && 'text-danger',
      )}
    >
      <span className={cn('shrink-0', tone === 'danger' ? 'text-danger' : 'text-muted')}>{icon}</span>
      <span className="text-[0.9375rem] font-medium">{label}</span>
    </button>
  );
}

function ChoiceCard({
  title,
  description,
  onClick,
  recommended = false,
  destructive = false,
  disabled = false,
}: {
  title: string;
  description: string;
  onClick: () => void;
  recommended?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'tap flex w-full flex-col gap-1 rounded-xl border p-3.5 text-left disabled:opacity-50',
        destructive
          ? 'border-danger/30 bg-danger-soft active:bg-danger-soft/70'
          : 'border-accent/30 bg-accent-soft active:bg-accent-soft/70',
      )}
    >
      <span className="flex items-center gap-2">
        <span className={cn('text-[0.9375rem] font-semibold', destructive ? 'text-danger' : 'text-accent')}>
          {title}
        </span>
        {recommended ? (
          <span className="rounded-md bg-accent px-1.5 py-0.5 text-[0.625rem] font-bold tracking-wide text-accent-fg uppercase">
            Safer
          </span>
        ) : null}
      </span>
      <span className="text-[0.8125rem] leading-relaxed text-fg/80">{description}</span>
    </button>
  );
}
