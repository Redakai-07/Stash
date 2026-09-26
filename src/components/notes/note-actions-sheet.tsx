'use client';

import * as React from 'react';
import {
  Archive,
  ArrowLeft,
  Check,
  FilePlus2,
  FolderInput,
  Link2,
  Lock,
  PencilLine,
  Star,
  Trash2,
  Unlock,
} from 'lucide-react';
import type { Note, NoteDeletionImpact } from '@/db/types';
import { pluralize } from '@/lib/format';
import { useBackDismiss } from '@/hooks/use-back-dismiss';
import { useVaultStore, selectChildNotes, selectDescendantNoteCount } from '@/stores/vault-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { NotePicker } from './note-picker';

/**
 * Everything you can do to one note.
 *
 * Deleting is the only destructive action and it is never reachable in one tap:
 * the sheet first reports exactly how many subnotes and references are involved
 * and offers "keep the subnotes" as the recommended path. Saved links are never
 * deleted by a note, and the confirmation says so.
 */

type Mode = 'actions' | 'rename' | 'move' | 'delete';

export interface NoteActionsSheetProps {
  note: Note | null;
  onClose: () => void;
  /** Navigate to a note, used after creating a subnote. */
  onOpenNote: (noteId: string) => void;
  onDeleted?: (noteId: string) => void;
}

export function NoteActionsSheet({ note, onClose, onOpenNote, onDeleted }: NoteActionsSheetProps) {
  const notes = useVaultStore((state) => state.notes);
  const [mode, setMode] = React.useState<Mode>('actions');
  const [title, setTitle] = React.useState(note?.title ?? '');
  const [impact, setImpact] = React.useState<NoteDeletionImpact | null>(null);
  const [busy, setBusy] = React.useState(false);

  const childCount = useVaultStore((state) =>
    note ? selectChildNotes(state, note.id).length : 0,
  );
  const descendantCount = useVaultStore((state) =>
    note ? selectDescendantNoteCount(state, note.id) : 0,
  );
  // Counted, not collected: a selector that built a new array each call would
  // make every store update look like a change and re-render needlessly.
  const resourceCount = useVaultStore((state) =>
    note ? state.noteLinks.filter((row) => row.noteId === note.id).length : 0,
  );

  const close = React.useCallback(() => {
    setMode('actions');
    onClose();
  }, [onClose]);

  useBackDismiss(Boolean(note), close);

  React.useEffect(() => {
    if (!note) return;
    let cancelled = false;
    void useVaultStore
      .getState()
      .noteDeletionImpact(note.id)
      .then((result) => {
        if (!cancelled) setImpact(result);
      });
    return () => {
      cancelled = true;
    };
  }, [note]);

  if (!note) return null;

  const addSubnote = async () => {
    setBusy(true);
    const result = await useVaultStore.getState().createNote({
      title: 'New subnote',
      content: '',
      parentNoteId: note.id,
    });
    setBusy(false);
    if (!result.ok) {
      toast(result.message, { tone: 'danger' });
      return;
    }
    close();
    onOpenNote(result.note.id);
  };

  const handleRename = async () => {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      toast('Give the note a title', { tone: 'danger' });
      return;
    }
    setBusy(true);
    const ok = await useVaultStore.getState().renameNote(note.id, trimmed);
    setBusy(false);
    if (!ok) {
      toast('Could not rename that note', { tone: 'danger' });
      return;
    }
    toast('Note renamed', { tone: 'success' });
    close();
  };

  const handleMove = async (parentNoteId: string | null) => {
    setBusy(true);
    const result = await useVaultStore.getState().moveNote(note.id, parentNoteId);
    setBusy(false);
    if (!result.ok) {
      toast(result.reason, { tone: 'danger' });
      return;
    }
    toast('Note moved', { tone: 'success' });
    close();
  };

  const handleDelete = async (strategy: 'keep-children' | 'delete-subtree') => {
    setBusy(true);
    const ok = await useVaultStore.getState().deleteNote(note.id, strategy);
    setBusy(false);
    if (!ok) {
      toast('Could not delete that note', { tone: 'danger' });
      return;
    }
    toast(strategy === 'keep-children' ? 'Note removed, subnotes kept' : 'Note and subnotes deleted');
    onDeleted?.(note.id);
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
                onClick={() => setMode('actions')}
                aria-label="Back"
                className="tap -ml-1.5 flex size-9 shrink-0 items-center justify-center rounded-full text-accent active:bg-surface-2"
              >
                <ArrowLeft size={19} strokeWidth={2.1} aria-hidden />
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate">
                {mode === 'rename'
                  ? 'Rename note'
                  : mode === 'move'
                    ? 'Move note'
                    : mode === 'delete'
                      ? 'Delete note?'
                      : note.title}
              </SheetTitle>
              <p className="mt-0.5 truncate text-xs text-subtle">
                {pluralize(childCount, 'subnote')}
                {resourceCount > 0 ? ` · ${pluralize(resourceCount, 'link')}` : ''}
                {note.isLocked ? ' · locked' : ''}
              </p>
            </div>
          </div>
        </SheetHeader>

        <SheetBody>
          {mode === 'rename' ? (
            <div className="flex flex-col gap-3 px-3 pb-2">
              <Input
                value={title}
                autoFocus
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleRename();
                  }
                }}
                aria-label="Note title"
                maxLength={120}
                enterKeyHint="done"
              />
            </div>
          ) : mode === 'move' ? (
            <NotePicker
              notes={notes.filter((candidate) => !candidate.isArchived)}
              selectedNoteId={note.parentNoteId}
              movingNoteId={note.id}
              onSelect={(parentNoteId) => void handleMove(parentNoteId)}
              alwaysFilterable
              filterPlaceholder="Find a parent note"
            />
          ) : mode === 'delete' ? (
            <div className="flex flex-col gap-3 px-3 pb-2">
              <div className="rounded-xl border border-border bg-surface-2 p-3.5">
                <p className="text-[0.9375rem] font-semibold text-fg">“{note.title}” contains</p>
                <ul className="mt-2 flex flex-col gap-1 text-[0.8125rem] text-muted">
                  <li>· {pluralize(childCount, 'direct subnote')}</li>
                  <li>· {pluralize(descendantCount, 'note')} in total below it</li>
                  <li>· {pluralize(impact?.referencedLinkCount ?? resourceCount, 'referenced link')}</li>
                </ul>
                <p className="mt-2.5 text-xs leading-relaxed text-subtle">
                  Referenced links stay in your vault. Deleting a note only removes the note and the
                  references to it.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void handleDelete('keep-children')}
                disabled={busy}
                className="tap flex w-full flex-col gap-1 rounded-xl border border-accent/30 bg-accent-soft p-3.5 text-left active:bg-accent-soft/70 disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  <span className="text-[0.9375rem] font-semibold text-accent">Delete only this note</span>
                  <span className="rounded-md bg-accent px-1.5 py-0.5 text-[0.625rem] font-bold tracking-wide text-accent-fg uppercase">
                    Keeps subnotes
                  </span>
                </span>
                <span className="text-[0.8125rem] leading-relaxed text-fg/80">
                  {childCount > 0
                    ? `Its ${pluralize(childCount, 'subnote')} move up to where it sits now.`
                    : 'Nothing else is affected.'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => void handleDelete('delete-subtree')}
                disabled={busy}
                className="tap flex w-full flex-col gap-1 rounded-xl border border-danger/30 bg-danger-soft p-3.5 text-left active:bg-danger-soft/70 disabled:opacity-50"
              >
                <span className="text-[0.9375rem] font-semibold text-danger">Delete this note and everything inside</span>
                <span className="text-[0.8125rem] leading-relaxed text-fg/80">
                  {descendantCount > 0
                    ? `${pluralize(descendantCount, 'note')} are removed permanently.`
                    : 'No subnotes to remove.'}
                </span>
              </button>

              <Button variant="ghost" className="w-full" onClick={() => setMode('actions')} disabled={busy}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 px-3 pb-2">
              <ActionRow
                icon={<FilePlus2 size={18} strokeWidth={1.9} aria-hidden />}
                label="Add a subnote"
                onClick={() => void addSubnote()}
              />
              <ActionRow
                icon={<PencilLine size={18} strokeWidth={1.9} aria-hidden />}
                label="Rename note"
                onClick={() => setMode('rename')}
              />
              <ActionRow
                icon={<FolderInput size={18} strokeWidth={1.9} aria-hidden />}
                label="Move to another note"
                onClick={() => setMode('move')}
              />
              <ActionRow
                icon={
                  <Star
                    size={18}
                    strokeWidth={1.9}
                    className={cn(note.isFavorite && 'fill-warning text-warning')}
                    aria-hidden
                  />
                }
                label={note.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                onClick={() => {
                  void useVaultStore.getState().toggleNoteFavorite(note.id);
                  close();
                }}
              />
              <ActionRow
                icon={
                  note.isLocked ? (
                    <Unlock size={18} strokeWidth={1.9} aria-hidden />
                  ) : (
                    <Lock size={18} strokeWidth={1.9} aria-hidden />
                  )
                }
                label={note.isLocked ? 'Unlock to edit again' : 'Lock against editing'}
                onClick={() => {
                  void useVaultStore.getState().toggleNoteLocked(note.id);
                  toast(note.isLocked ? 'Unlocked' : 'Locked — reading only', { tone: 'success' });
                  close();
                }}
              />
              <ActionRow
                icon={<Archive size={18} strokeWidth={1.9} aria-hidden />}
                label={note.isArchived ? 'Restore from archive' : 'Archive note and subnotes'}
                onClick={() => {
                  void useVaultStore.getState().archiveNote(note.id, !note.isArchived);
                  toast(note.isArchived ? 'Restored' : 'Archived');
                  close();
                }}
              />
              {resourceCount > 0 ? (
                <p className="flex items-center gap-1.5 px-2 pt-1 text-xs text-subtle">
                  <Link2 size={13} strokeWidth={2} aria-hidden />
                  {pluralize(resourceCount, 'linked resource')} stay in your vault.
                </p>
              ) : null}
              <ActionRow
                icon={<Trash2 size={18} strokeWidth={1.9} aria-hidden />}
                label="Delete note"
                tone="danger"
                onClick={() => setMode('delete')}
              />
            </div>
          )}
        </SheetBody>

        {mode === 'rename' ? (
          <SheetFooter>
            <Button variant="primary" size="lg" className="w-full" onClick={() => void handleRename()} disabled={busy}>
              <Check size={18} strokeWidth={2.4} aria-hidden />
              Save title
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
