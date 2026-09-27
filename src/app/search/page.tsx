'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Clock, Search as SearchIcon, SearchX, X } from 'lucide-react';
import type { Note, SavedLink } from '@/db/types';
import { SEARCH_FILTERS, searchVault, type SearchFilter } from '@/lib/search';
import { pluralize } from '@/lib/format';
import { openExternal } from '@/lib/open-external';
import { useVaultStore } from '@/stores/vault-store';
import { PageHeader, Section } from '@/components/ui/page';
import { LinkRow } from '@/components/links/link-row';
import { LinkActionsSheet } from '@/components/links/link-actions-sheet';
import { FolderRow } from '@/components/folders/folder-row';
import { NoteRow } from '@/components/notes/note-row';
import { NoteActionsSheet } from '@/components/notes/note-actions-sheet';
import { cn } from '@/lib/utils';

/**
 * Search.
 *
 * Runs over the in-memory snapshot of IndexedDB, so it works in airplane mode,
 * returns instantly, and can search things a URL bar cannot: your own writing,
 * your tags, and the folder names you invented.
 *
 * Results come back in groups -- folders, notes, links -- rather than one merged
 * list. Mixing a subnote in among bookmark rows makes the list harder to read,
 * not easier, and it hides which kind of thing matched.
 */

const FILTER_IDS = new Set(SEARCH_FILTERS.map((filter) => filter.id));

function isFilter(value: string | null): value is SearchFilter {
  return value !== null && FILTER_IDS.has(value as SearchFilter);
}

function SearchView() {
  const params = useSearchParams();
  const router = useRouter();
  const initialFilter = params.get('filter');

  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<SearchFilter>(isFilter(initialFilter) ? initialFilter : 'all');
  const [activeLink, setActiveLink] = React.useState<SavedLink | null>(null);
  const [activeNote, setActiveNote] = React.useState<Note | null>(null);

  const folders = useVaultStore((state) => state.folders);
  const links = useVaultStore((state) => state.links);
  const tags = useVaultStore((state) => state.tags);
  const linkTags = useVaultStore((state) => state.linkTags);
  const notes = useVaultStore((state) => state.notes);
  const noteLinks = useVaultStore((state) => state.noteLinks);
  const hidden = useVaultStore((state) => state.hidden);
  const toggleLinkFavorite = useVaultStore((state) => state.toggleLinkFavorite);
  const markLinkOpened = useVaultStore((state) => state.markLinkOpened);

  const inputRef = React.useRef<HTMLInputElement>(null);

  const searching = query.trim().length > 0;

  const outcome = React.useMemo(
    () =>
      searchVault(
        { folders, links, tags, linkTags, notes, noteLinks },
        {
          query,
          filter,
          limit: 120,
          folderLimit: searching ? 8 : 0,
          noteLimit: 80,
          includeFolders: searching,
          // Belt and braces: the collections above are already filtered, and the
          // search engine filters again from these sets. Two independent points
          // have to be wrong before a locked item can appear in a result.
          hidden,
        },
      ),
    [folders, links, tags, linkTags, notes, noteLinks, hidden, query, filter, searching],
  );

  const folderNameById = React.useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.name])),
    [folders],
  );

  const openLink = React.useCallback(
    (link: SavedLink) => {
      void markLinkOpened(link.id);
      void openExternal(link.url);
    },
    [markLinkOpened],
  );

  const showRecent = query.trim().length === 0;

  return (
    <>
      <PageHeader>
        <div className="relative">
          <SearchIcon
            size={17}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search links, notes, folders…"
            aria-label="Search your vault"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className={cn(
              'h-12 w-full rounded-xl border border-border bg-surface-2 pr-10 pl-10 text-[1.0625rem] text-fg',
              'placeholder:text-subtle focus:border-accent focus:bg-surface focus:outline-none',
            )}
          />
          {query.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="tap absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-subtle active:bg-surface-3"
            >
              <X size={16} strokeWidth={2.2} aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="-mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-1 pb-0.5 no-scrollbar">
          {SEARCH_FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setFilter(option.id);
                router.replace(option.id === 'all' ? '/search' : `/search?filter=${option.id}`, {
                  scroll: false,
                });
              }}
              aria-pressed={filter === option.id}
              className={cn(
                'tap shrink-0 rounded-full px-3 py-1.5 text-[0.8125rem] font-medium transition-colors',
                filter === option.id
                  ? 'bg-accent text-accent-fg'
                  : 'border border-border bg-surface text-muted active:bg-surface-2',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </PageHeader>

      {outcome.folders.length > 0 ? (
        <Section title="Folders">
          <div className="flex flex-col gap-0.5 px-2">
            {outcome.folders.map((hit) => (
              <FolderRow
                key={hit.folder.id}
                folder={hit.folder}
                subtitle={hit.path}
                onOpen={() => router.push(`/library?folder=${hit.folder.id}`)}
                onShowActions={() => router.push(`/library?folder=${hit.folder.id}`)}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {outcome.notes.length > 0 ? (
        <Section
          title={
            showRecent
              ? 'Notes'
              : `${pluralize(outcome.notes.length, 'note')}${outcome.relaxed ? ' · loose match' : ''}`
          }
        >
          <div className="flex flex-col gap-0.5 px-2">
            {outcome.notes.map((hit) => (
              <NoteRow
                key={hit.note.id}
                note={hit.note}
                subtitle={searching ? hit.path : undefined}
                linkCount={hit.resourceTitles.length}
                highlight={searching}
                onOpen={() => router.push(`/notes?note=${hit.note.id}`)}
                onShowActions={() => setActiveNote(hit.note)}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {outcome.links.length > 0 ? (
        <Section
          title={
            showRecent
              ? filter === 'favorites'
                ? 'Favorites'
                : 'Recently saved'
              : `${pluralize(outcome.links.length, 'result')}${outcome.relaxed ? ' · loose match' : ''}`
          }
        >
          <div className="flex flex-col gap-0.5 px-2">
            {outcome.links.map((hit) => (
              <LinkRow
                key={hit.link.id}
                link={hit.link}
                context={folderNameById.get(hit.link.folderId ?? '')}
                highlight={!showRecent}
                onOpen={() => openLink(hit.link)}
                onToggleFavorite={() => void toggleLinkFavorite(hit.link.id)}
                onShowActions={() => setActiveLink(hit.link)}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {outcome.links.length === 0 && outcome.folders.length === 0 && outcome.notes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-8 py-14 text-center">
          <span className="mb-1 flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-subtle">
            <SearchX size={22} strokeWidth={1.7} aria-hidden />
          </span>
          <p className="text-[0.9375rem] font-semibold text-fg">
            {query.trim() ? 'Nothing matches that' : filter === 'all' ? 'Your vault is empty' : 'Nothing here yet'}
          </p>
          <p className="max-w-xs text-[0.8125rem] leading-relaxed text-muted">
            {query.trim()
              ? 'Search covers link titles, addresses, your own notes and subnotes, tags and folder names. Everything is searched on this device.'
              : 'Save a link or write a note and it will show up here, searchable offline.'}
          </p>
        </div>
      ) : null}

      {showRecent && filter === 'all' && (links.length > 0 || notes.length > 0) ? (
        <p className="flex items-center justify-center gap-1.5 px-4 py-6 text-xs text-subtle">
          <Clock size={13} strokeWidth={2} aria-hidden />
          Newest first · searched offline
        </p>
      ) : null}

      <div className="h-4" />

      <LinkActionsSheet
        key={activeLink?.id ?? 'no-link'}
        link={activeLink}
        onClose={() => setActiveLink(null)}
      />
      <NoteActionsSheet
        key={activeNote?.id ?? 'no-note'}
        note={activeNote}
        onClose={() => setActiveNote(null)}
        onOpenNote={(id) => router.push(`/notes?note=${id}`)}
      />
    </>
  );
}

export default function SearchPage() {
  return (
    <React.Suspense fallback={<div className="h-dvh bg-bg" />}>
      <SearchView />
    </React.Suspense>
  );
}

