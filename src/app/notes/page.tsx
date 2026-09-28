'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, FilePlus2, Layers, MoreHorizontal, NotebookPen, Star } from 'lucide-react';
import type { Note, SavedLink } from '@/db/types';
import { pluralize } from '@/lib/format';
import { openExternal } from '@/lib/open-external';
import { noteChildren, noteDescendantIds } from '@/lib/tree';
import { useVaultStore } from '@/stores/vault-store';
import { Button } from '@/components/ui/button';
import { EmptyState, ListSurface, PageHeader, PageTitle, Section } from '@/components/ui/page';
import { toast } from '@/components/ui/toast';
import { NoteEditor } from '@/components/notes/note-editor';
import { NoteRow } from '@/components/notes/note-row';
import { NoteActionsSheet } from '@/components/notes/note-actions-sheet';
import { NoteResources } from '@/components/notes/note-resources';
import { LinkPickerSheet } from '@/components/links/link-picker-sheet';
import { LinkActionsSheet } from '@/components/links/link-actions-sheet';

/**
 * Notes.
 *
 * One route with a `?note=` parameter rather than a route per note, because the
 * tree is unbounded: a path segment per level would produce URLs nobody can read
 * and a navigation stack that grows with nesting. The query keeps the tree a
 * single, browsable surface, and the hardware back button still walks out of
 * nesting naturally.
 *
 * Small screens get breadcrumbs and contextual child lists -- never a permanent
 * desktop-style sidebar.
 */
function NotesView() {
  const params = useSearchParams();
  const router = useRouter();
  const noteId = params.get('note');

  const notes = useVaultStore((state) => state.notes);
  const visibleNotes = useVaultStore((state) => state.visibleNotes);
  const links = useVaultStore((state) => state.links);
  const noteLinks = useVaultStore((state) => state.noteLinks);
  // Inherited locks count: a subnote of a locked note is encrypted too, so it
  // must open read-only even though its own flag is false.
  const protectedNoteIds = useVaultStore((state) => state.protection.notes);

  const [activeNote, setActiveNote] = React.useState<Note | null>(null);
  const [activeLink, setActiveLink] = React.useState<SavedLink | null>(null);
  const [picking, setPicking] = React.useState(false);

  const current = React.useMemo(
    () => (noteId ? notes.find((note) => note.id === noteId) ?? null : null),
    [notes, noteId],
  );

  // Derived once per render pass rather than per row: a list rebuilt inside a
  // selector would make every store update look like a change.
  const { childCounts, linkCounts, trail, subnotes, resources } = React.useMemo(() => {
    const childCounts = new Map<string, number>();
    for (const note of visibleNotes) {
      if (!note.parentNoteId) continue;
      childCounts.set(note.parentNoteId, (childCounts.get(note.parentNoteId) ?? 0) + 1);
    }

    const linkCounts = new Map<string, number>();
    for (const row of noteLinks) {
      linkCounts.set(row.noteId, (linkCounts.get(row.noteId) ?? 0) + 1);
    }

    const trail: Note[] = [];
    const subnotes: Note[] = [];
    const resources: SavedLink[] = [];

    if (current) {
      const byId = new Map(notes.map((note) => [note.id, note]));
      const guard = new Set<string>();
      let cursor: Note | undefined = current;
      while (cursor && !guard.has(cursor.id)) {
        guard.add(cursor.id);
        trail.unshift(cursor);
        cursor = cursor.parentNoteId ? byId.get(cursor.parentNoteId) : undefined;
      }

      subnotes.push(...noteChildren(visibleNotes, current.id));

      const linkById = new Map(links.map((link) => [link.id, link]));
      resources.push(
        ...noteLinks
          .filter((row) => row.noteId === current.id)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((row) => linkById.get(row.linkId))
          .filter((link): link is SavedLink => Boolean(link)),
      );
    }

    return { childCounts, linkCounts, trail, subnotes, resources };
  }, [current, links, noteLinks, notes, visibleNotes]);

  const rootNotes = React.useMemo(() => noteChildren(visibleNotes, null), [visibleNotes]);
  const recentNotes = React.useMemo(
    () => [...visibleNotes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4),
    [visibleNotes],
  );
  const favoriteNotes = React.useMemo(
    () => visibleNotes.filter((note) => note.isFavorite).slice(0, 4),
    [visibleNotes],
  );

  const openNote = React.useCallback(
    (id: string) => {
      router.push(`/notes?note=${id}`);
    },
    [router],
  );

  const createNote = React.useCallback(
    async (parentNoteId: string | null) => {
      const result = await useVaultStore.getState().createNote({
        title: parentNoteId ? 'New subnote' : 'New note',
        content: '',
        parentNoteId,
      });
      if (!result.ok) {
        toast(result.message, { tone: 'danger' });
        return;
      }
      openNote(result.note.id);
    },
    [openNote],
  );

  const openLink = React.useCallback((link: SavedLink) => {
    void useVaultStore.getState().markLinkOpened(link.id);
    void openExternal(link.url);
  }, []);

  // ---------------------------------------------------------------------------
  // Note detail
  // ---------------------------------------------------------------------------
  if (noteId) {
    if (!current) {
      return (
        <>
          <PageHeader>
            <PageTitle subtitle="It may have been deleted">Note not found</PageTitle>
          </PageHeader>
          <EmptyState
            icon={<NotebookPen size={22} strokeWidth={1.7} />}
            title="This note is gone"
            description="It was deleted, moved out of view, or the link is stale."
            action={
              <Button variant="accentSoft" size="sm" onClick={() => router.push('/notes')}>
                Back to notes
              </Button>
            }
          />
        </>
      );
    }

    const parentId = current.parentNoteId;
    const descendantCount = noteDescendantIds(notes, current.id).length;

    return (
      <>
        <PageHeader className="pb-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => (parentId ? openNote(parentId) : router.push('/notes'))}
              aria-label={parentId ? 'Go to parent note' : 'Back to all notes'}
              className="tap -ml-1.5 flex size-9 shrink-0 items-center justify-center rounded-full text-accent active:bg-surface-2"
            >
              <ChevronLeft size={20} strokeWidth={2.2} aria-hidden />
            </button>

            <nav aria-label="Breadcrumb" className="scroll-area flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-xs text-subtle no-scrollbar">
              <button
                type="button"
                onClick={() => router.push('/notes')}
                className="tap shrink-0 rounded px-1 py-0.5 active:bg-surface-2"
              >
                Notes
              </button>
              {trail.slice(0, -1).map((note) => (
                <React.Fragment key={note.id}>
                  <ChevronRight size={12} strokeWidth={2.2} className="shrink-0 text-subtle" aria-hidden />
                  <button
                    type="button"
                    onClick={() => openNote(note.id)}
                    className="tap max-w-[8rem] shrink-0 truncate rounded px-1 py-0.5 active:bg-surface-2"
                  >
                    {note.title}
                  </button>
                </React.Fragment>
              ))}
              <ChevronRight size={12} strokeWidth={2.2} className="shrink-0 text-subtle" aria-hidden />
              <span className="max-w-[9rem] shrink-0 truncate px-1 py-0.5 font-medium text-muted">
                {current.title}
              </span>
            </nav>

            <button
              type="button"
              onClick={() => setActiveNote(current)}
              aria-label="Note actions"
              className="tap flex size-9 shrink-0 items-center justify-center rounded-full text-muted active:bg-surface-2"
            >
              <MoreHorizontal size={19} strokeWidth={2} aria-hidden />
            </button>
          </div>

          <p className="mt-1 flex items-center gap-2 pl-8 text-xs text-subtle">
            <span>{pluralize(descendantCount, 'note')} below</span>
            {current.isFavorite ? (
              <Star size={12} strokeWidth={2.4} className="fill-warning text-warning" aria-label="Favorite" />
            ) : null}
          </p>
        </PageHeader>

        <NoteEditor
          key={current.id}
          note={current}
          readOnly={protectedNoteIds.has(current.id)}
          {...(current.isLocked
            ? { onUnlock: () => void useVaultStore.getState().toggleNoteLocked(current.id, false) }
            : {})}
          save={async (draft) => {
            await useVaultStore.getState().saveNoteDraft(current.id, draft);
          }}
        />

        <Section title="Subnotes" className="pt-2">
          {subnotes.length > 0 ? (
            <ListSurface>
              {subnotes.map((subnote) => (
                <NoteRow
                  key={subnote.id}
                  note={subnote}
                  childCount={noteChildren(visibleNotes, subnote.id).length}
                  linkCount={linkCounts.get(subnote.id) ?? 0}
                  onOpen={() => openNote(subnote.id)}
                  onShowActions={() => setActiveNote(subnote)}
                  onToggleFavorite={() => void useVaultStore.getState().toggleNoteFavorite(subnote.id)}
                />
              ))}
            </ListSurface>
          ) : (
            <p className="px-4 pb-1 text-[0.8125rem] leading-relaxed text-subtle">
              No subnotes yet. Splitting a large topic into subnotes keeps each one short and
              findable.
            </p>
          )}

          <div className="px-4 pt-2">
            <button
              type="button"
              onClick={() => void createNote(current.id)}
              className="tap flex w-full items-center gap-3 rounded-xl border border-dashed border-border-strong px-3 py-2.5 text-left active:bg-surface-2"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent">
                <FilePlus2 size={17} strokeWidth={2.1} aria-hidden />
              </span>
              <span className="text-[0.9375rem] font-medium text-accent">Add subnote</span>
            </button>
          </div>
        </Section>

        <NoteResources
          links={resources}
          readOnly={protectedNoteIds.has(current.id)}
          onOpenLink={openLink}
          onDetach={(linkId) => {
            void useVaultStore.getState().detachLink(current.id, linkId);
            toast('Detached. The link is still saved.');
          }}
          onAttach={() => setPicking(true)}
        />

        {/* Space for the fixed formatting bar. */}
        <div className="h-24" />

        <NoteActionsSheet
          key={activeNote?.id ?? 'no-note'}
          note={activeNote}
          onClose={() => setActiveNote(null)}
          onOpenNote={openNote}
          onDeleted={(deletedId) => {
            if (deletedId === noteId) router.push('/notes');
          }}
        />

        <LinkPickerSheet
          open={picking}
          onClose={() => setPicking(false)}
          attachedIds={resources.map((link) => link.id)}
          onPick={(link) => {
            setPicking(false);
            void useVaultStore.getState().attachLink(current.id, link.id).then((ok) => {
              toast(ok ? 'Link attached' : 'Could not attach that link', {
                tone: ok ? 'success' : 'danger',
              });
            });
          }}
        />

        <LinkActionsSheet
          key={activeLink?.id ?? 'no-link'}
          link={activeLink}
          onClose={() => setActiveLink(null)}
        />
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Notes index
  // ---------------------------------------------------------------------------
  const isEmpty = visibleNotes.length === 0;

  return (
    <>
      <PageHeader>
        <div className="flex items-end justify-between gap-3">
          <PageTitle
            subtitle={
              isEmpty
                ? 'Nothing written yet'
                : `${pluralize(visibleNotes.length, 'note')} · offline`
            }
          >
            Notes
          </PageTitle>
          <Button variant="accentSoft" size="icon" aria-label="New note" onClick={() => void createNote(null)}>
            <FilePlus2 size={19} strokeWidth={2} aria-hidden />
          </Button>
        </div>
      </PageHeader>

      {isEmpty ? (
        <div className="px-4">
          <EmptyState
            icon={<NotebookPen size={22} strokeWidth={1.7} />}
            title="Start with a thought."
            description="A note is your own words next to the things you saved. Write one line now and break it into subnotes as it grows — nothing here needs a title, a folder or a network."
            action={
              <Button variant="accentSoft" size="sm" onClick={() => void createNote(null)}>
                <FilePlus2 size={16} strokeWidth={2} aria-hidden />
                New note
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {favoriteNotes.length > 0 ? (
            <Section title="Favorites">
              <ListSurface>
                {favoriteNotes.map((note) => (
                  <NoteRow
                    key={note.id}
                    note={note}
                    childCount={childCounts.get(note.id) ?? 0}
                    linkCount={linkCounts.get(note.id) ?? 0}
                    onOpen={() => openNote(note.id)}
                    onShowActions={() => setActiveNote(note)}
                    onToggleFavorite={() => void useVaultStore.getState().toggleNoteFavorite(note.id)}
                  />
                ))}
              </ListSurface>
            </Section>
          ) : null}

          <Section title="Recently edited">
            <ListSurface>
              {recentNotes.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  childCount={childCounts.get(note.id) ?? 0}
                  linkCount={linkCounts.get(note.id) ?? 0}
                  onOpen={() => openNote(note.id)}
                  onShowActions={() => setActiveNote(note)}
                  onToggleFavorite={() => void useVaultStore.getState().toggleNoteFavorite(note.id)}
                />
              ))}
            </ListSurface>
          </Section>

          <Section title="All notes" className="pb-6">
            {rootNotes.length > 0 ? (
              <ListSurface>
                {rootNotes.map((note) => (
                  <NoteRow
                    key={note.id}
                    note={note}
                    childCount={childCounts.get(note.id) ?? 0}
                    linkCount={linkCounts.get(note.id) ?? 0}
                    onOpen={() => openNote(note.id)}
                    onShowActions={() => setActiveNote(note)}
                    onToggleFavorite={() => void useVaultStore.getState().toggleNoteFavorite(note.id)}
                  />
                ))}
              </ListSurface>
            ) : (
              <div className="px-4">
                <EmptyState
                  icon={<Layers size={20} strokeWidth={1.8} />}
                  title="Everything is nested"
                  description="You have no top-level notes. Open a note and add a sibling by moving one to the top level."
                />
              </div>
            )}
          </Section>
        </>
      )}

      <NoteActionsSheet
        key={activeNote?.id ?? 'no-note'}
        note={activeNote}
        onClose={() => setActiveNote(null)}
        onOpenNote={openNote}
      />
    </>
  );
}

export default function NotesPage() {
  return (
    <React.Suspense fallback={<div className="h-dvh bg-bg" />}>
      <NotesView />
    </React.Suspense>
  );
}
