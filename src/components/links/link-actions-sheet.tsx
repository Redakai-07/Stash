'use client';

import * as React from 'react';
import { Archive, ArrowLeft, Check, Copy, ExternalLink, FilePlus2, FolderInput, NotebookPen, Star, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { SavedLink } from '@/db/types';
import { destinationLabel, INBOX_DESTINATION, folderDestination } from '@/lib/destination';
import { displayUrl, formatShortDate } from '@/lib/format';
import { useBackDismiss } from '@/hooks/use-back-dismiss';
import { useVaultStore, selectNotesForLink } from '@/stores/vault-store';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { FolderDestinationList } from '@/components/capture/folder-destination-list';
import { NotePicker } from '@/components/notes/note-picker';

/**
 * Everything you can do to one saved link.
 *
 * The move flow reuses the very same folder list as capture, so "where does
 * this go" behaves identically whether you are saving or reorganising later.
 */

type Mode = 'actions' | 'move' | 'confirm-delete' | 'attach-note';

export interface LinkActionsSheetProps {
  link: SavedLink | null;
  onClose: () => void;
}

export function LinkActionsSheet({ link, onClose }: LinkActionsSheetProps) {
  const router = useRouter();
  const folders = useVaultStore((state) => state.folders);
  const notes = useVaultStore((state) => state.notes);
  // Notes that already reference this link, so a saved link can show what
  // thinking it is attached to.
  const referencingNotes = useVaultStore((state) => (link ? selectNotesForLink(state, link.id) : []));
  // State is initialised from props and reset by remounting: callers pass a
  // `key` derived from the link id, so a different link always starts clean.
  const [mode, setMode] = React.useState<Mode>('actions');
  const [note, setNote] = React.useState(link?.userNote ?? '');
  const [busy, setBusy] = React.useState(false);

  const close = React.useCallback(() => {
    setMode('actions');
    onClose();
  }, [onClose]);

  useBackDismiss(Boolean(link), close);

  if (!link) return null;

  const noteDirty = note.trim() !== (link.userNote ?? '').trim();

  const openLink = () => {
    void useVaultStore.getState().markLinkOpened(link.id);
    window.open(link.url, '_blank', 'noopener,noreferrer');
    close();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      toast('Link copied');
    } catch {
      toast('Could not copy the link', { tone: 'danger' });
    }
  };

  const saveNote = async () => {
    setBusy(true);
    await useVaultStore.getState().updateLink(link.id, { userNote: note });
    setBusy(false);
    toast('Note saved', { tone: 'success' });
  };

  const move = async (folderId: string | null) => {
    setBusy(true);
    await useVaultStore.getState().moveLink(link.id, folderId);
    setBusy(false);
    const label = folderId ? destinationLabel(folderDestination(folderId), folders) : 'Inbox';
    toast(`Moved to ${label}`, { tone: 'success' });
    close();
  };

  const attachToNote = async (noteId: string) => {
    setBusy(true);
    const ok = await useVaultStore.getState().attachLink(noteId, link.id, 'attached');
    setBusy(false);
    if (!ok) {
      toast('Already attached to that note', { tone: 'danger' });
      return;
    }
    toast('Attached to note', { tone: 'success' });
    close();
  };

  const createNote = async () => {
    setBusy(true);
    const result = await useVaultStore.getState().createNoteFromLink(link.id);
    setBusy(false);
    if (!result.ok) {
      toast(result.message, { tone: 'danger' });
      return;
    }
    toast('Note created', { tone: 'success' });
    close();
    router.push(`/notes?note=${result.note.id}`);
  };

  const remove = async () => {
    setBusy(true);
    const removed = link;
    await useVaultStore.getState().deleteLink(link.id);
    setBusy(false);
    toast('Link deleted', {
      action: {
        label: 'Undo',
        onSelect: () => {
          void useVaultStore.getState().saveLink({
            url: removed.url,
            folderId: removed.folderId,
            title: removed.title,
            userNote: removed.userNote,
            source: removed.source,
            rawText: removed.rawText,
            isFavorite: removed.isFavorite,
          });
        },
      },
      duration: 6000,
    });
    close();
  };

  const currentFolder = link.folderId ? destinationLabel(folderDestination(link.folderId), folders) : 'Inbox';

  return (
    <Sheet open onOpenChange={(next) => !next && close()}>
      <SheetContent>
        <SheetHeader>
          <div className="flex items-start gap-3">
            {mode !== 'actions' ? (
              <button
                type="button"
                onClick={() => setMode('actions')}
                aria-label="Back"
                className="tap -ml-1.5 flex size-9 shrink-0 items-center justify-center rounded-full text-accent active:bg-surface-2"
              >
                <ArrowLeft size={19} strokeWidth={2.1} aria-hidden />
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate">
                {mode === 'move'
                  ? 'Move to'
                  : mode === 'confirm-delete'
                    ? 'Delete link?'
                    : mode === 'attach-note'
                      ? 'Attach to a note'
                      : link.title?.trim() || displayUrl(link.url, 40)}
              </SheetTitle>
              <p className="mt-0.5 truncate text-xs text-subtle">
                {mode === 'move' ? currentFolder : `${link.source ?? ''} · ${formatShortDate(link.createdAt)}`}
              </p>
            </div>
          </div>
        </SheetHeader>

        <SheetBody>
          {mode === 'move' ? (
            <FolderDestinationList
              folders={folders}
              selection={link.folderId ? folderDestination(link.folderId) : INBOX_DESTINATION}
              onSelect={(selection) => void move(selection.kind === 'folder' ? selection.folderId : null)}
              showInbox
              filterPlaceholder="Find a folder"
            />
          ) : mode === 'attach-note' ? (
            <NotePicker
              notes={notes.filter((candidate) => !candidate.isArchived)}
              selectedNoteId={null}
              onSelect={(parentId) => {
                if (parentId) void attachToNote(parentId);
              }}
              filterPlaceholder="Find a note"
            />
          ) : mode === 'confirm-delete' ? (
            <div className="px-3 pb-2">
              <div className="rounded-xl border border-danger/30 bg-danger-soft p-3.5">
                <p className="text-[0.9375rem] font-semibold text-danger">This removes the link permanently</p>
                <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg/80">
                  “{link.title?.trim() || displayUrl(link.url, 40)}” and its note will be removed from your
                  vault. There is no trash for links yet, so this cannot be recovered after closing Stash.
                </p>
                <div className="mt-3.5 flex gap-2">
                  <Button variant="surface" className="flex-1" onClick={() => setMode('actions')} disabled={busy}>
                    Keep it
                  </Button>
                  <Button variant="danger" className="flex-1" onClick={() => void remove()} disabled={busy}>
                    <Trash2 size={17} strokeWidth={2.1} aria-hidden />
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 px-3 pb-2">
              <div className="rounded-xl border border-border bg-surface-2 px-3.5 py-3">
                <p className="text-[0.6875rem] font-semibold tracking-wider text-subtle uppercase">Address</p>
                <p className="mt-1 break-all text-[0.8125rem] leading-relaxed text-muted">{link.url}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted">
                    <FolderInput size={11} strokeWidth={2} aria-hidden />
                    {currentFolder}
                  </span>
                  {link.sourcePackage ? (
                    <span className="rounded-md bg-surface px-1.5 py-0.5 text-[0.6875rem] text-subtle">
                      via {link.sourcePackage.split('.').pop()}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 px-3.5 py-3">
                <label
                  htmlFor="link-note"
                  className="text-[0.6875rem] font-semibold tracking-wider text-subtle uppercase"
                >
                  Your note
                </label>
                <Textarea
                  id="link-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Why did you keep this?"
                  className="bg-surface text-[0.9375rem]"
                />
                {noteDirty ? (
                  <Button variant="accentSoft" size="sm" onClick={() => void saveNote()} disabled={busy}>
                    <Check size={16} strokeWidth={2.4} aria-hidden />
                    Save note
                  </Button>
                ) : null}
              </div>

              {referencingNotes.length > 0 ? (
                <div className="rounded-xl border border-border bg-surface-2 px-3.5 py-3">
                  <p className="text-[0.6875rem] font-semibold tracking-wider text-subtle uppercase">Referenced in</p>
                  <div className="mt-2 flex flex-col gap-1">
                    {referencingNotes.map((ref) => (
                      <button
                        key={ref.id}
                        type="button"
                        onClick={() => {
                          close();
                          router.push(`/notes?note=${ref.id}`);
                        }}
                        className="tap flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-left active:bg-surface-2"
                      >
                        <NotebookPen size={14} strokeWidth={1.9} className="shrink-0 text-muted" aria-hidden />
                        <span className="truncate text-[0.875rem] text-fg">{ref.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <ActionRow
                icon={<ExternalLink size={18} strokeWidth={1.9} aria-hidden />}
                label="Open link"
                onClick={openLink}
              />
              <ActionRow
                icon={<Copy size={18} strokeWidth={1.9} aria-hidden />}
                label="Copy address"
                onClick={() => void copyLink()}
              />
              <ActionRow
                icon={
                  <Star
                    size={18}
                    strokeWidth={1.9}
                    className={cn(link.isFavorite && 'fill-warning text-warning')}
                    aria-hidden
                  />
                }
                label={link.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                onClick={() => {
                  void useVaultStore.getState().toggleLinkFavorite(link.id);
                  close();
                }}
              />
              <ActionRow
                icon={<FilePlus2 size={18} strokeWidth={1.9} aria-hidden />}
                label="Create note from link"
                onClick={() => void createNote()}
              />
              <ActionRow
                icon={<NotebookPen size={18} strokeWidth={1.9} aria-hidden />}
                label={referencingNotes.length > 0 ? 'Attach to another note' : 'Attach to a note'}
                onClick={() => setMode('attach-note')}
              />
              <ActionRow
                icon={<FolderInput size={18} strokeWidth={1.9} aria-hidden />}
                label="Move to another folder"
                onClick={() => setMode('move')}
              />
              <ActionRow
                icon={<Archive size={18} strokeWidth={1.9} aria-hidden />}
                label={link.isArchived ? 'Restore from archive' : 'Archive link'}
                onClick={() => {
                  void useVaultStore.getState().archiveLink(link.id, !link.isArchived);
                  toast(link.isArchived ? 'Restored' : 'Archived');
                  close();
                }}
              />
              <ActionRow
                icon={<Trash2 size={18} strokeWidth={1.9} aria-hidden />}
                label="Delete link"
                tone="danger"
                onClick={() => setMode('confirm-delete')}
              />
            </div>
          )}
        </SheetBody>

        {mode === 'actions' ? (
          <SheetFooter>
            <Button variant="surface" className="w-full" onClick={close}>
              Close
            </Button>
          </SheetFooter>
        ) : null}
        {mode === 'attach-note' ? (
          <SheetFooter>
            <Button variant="accentSoft" className="w-full" onClick={() => void createNote()} disabled={busy}>
              <FilePlus2 size={17} strokeWidth={2} aria-hidden />
              New note from this link
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
