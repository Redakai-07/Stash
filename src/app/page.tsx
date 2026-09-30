'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, FolderPlus, Inbox as InboxIcon, Share2 } from 'lucide-react';
import type { Folder, Note, SavedLink } from '@/db/types';
import { childrenOf } from '@/lib/tree';
import { pluralize } from '@/lib/format';
import { openExternal } from '@/lib/open-external';
import {
  useVaultStore,
  selectFavoriteFolders,
  selectFavoriteNotes,
  selectInboxLinks,
  selectTagUsage,
} from '@/stores/vault-store';
import { Button } from '@/components/ui/button';
import { EmptyState, GroupSurface, ListSurface, PageHeader, PageTitle, Section } from '@/components/ui/page';
import { LogoMark } from '@/components/ui/logo';
import { LinkRow } from '@/components/links/link-row';
import { LinkActionsSheet } from '@/components/links/link-actions-sheet';
import { FolderRow } from '@/components/folders/folder-row';
import { FolderActionsSheet } from '@/components/folders/folder-actions-sheet';
import { NoteRow } from '@/components/notes/note-row';
import { NoteActionsSheet } from '@/components/notes/note-actions-sheet';

/**
 * Home answers exactly three questions, in the order they are usually asked:
 * what is still waiting for me, what did I save lately, and where do I want to
 * go? No counters-as-dashboard, no streaks, no scores.
 */
export default function HomePage() {
  const router = useRouter();
  const folders = useVaultStore((state) => state.folders);
  const links = useVaultStore((state) => state.links);
  const folderStats = useVaultStore((state) => state.folderStats);
  const inbox = useVaultStore(selectInboxLinks);
  const favoriteFolders = useVaultStore(selectFavoriteFolders);
  const favoriteNotes = useVaultStore(selectFavoriteNotes);
  const tags = useVaultStore(selectTagUsage);
  const toggleLinkFavorite = useVaultStore((state) => state.toggleLinkFavorite);
  const markLinkOpened = useVaultStore((state) => state.markLinkOpened);

  const [activeLink, setActiveLink] = React.useState<SavedLink | null>(null);
  const [activeFolder, setActiveFolder] = React.useState<Folder | null>(null);
  const [activeNote, setActiveNote] = React.useState<Note | null>(null);

  const activeLinks = React.useMemo(() => links.filter((link) => !link.isArchived), [links]);
  const recent = React.useMemo(
    () => [...activeLinks].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4),
    [activeLinks],
  );
  const favorites = React.useMemo(
    () => activeLinks.filter((link) => link.isFavorite).sort((a, b) => b.createdAt - a.createdAt).slice(0, 3),
    [activeLinks],
  );
  const roots = React.useMemo(() => childrenOf(folders, null), [folders]);
  const isEmpty = activeLinks.length === 0 && folders.length === 0;

  const openLink = React.useCallback(
    (link: SavedLink) => {
      void markLinkOpened(link.id);
      void openExternal(link.url);
    },
    [markLinkOpened],
  );

  return (
    <>
      <PageHeader>
        <PageTitle
          subtitle={
            isEmpty
              ? 'Nothing saved yet'
              : `${pluralize(activeLinks.length, 'link')} saved · ${pluralize(folders.length, 'folder')}`
          }
        >
          Your vault
        </PageTitle>
      </PageHeader>

      {/*
        The Inbox comes first, before anything saved, because it is the only part
        of Home that is asking for something. Everything below it is a list of
        things already dealt with.
      */}
      {!isEmpty && inbox.length > 0 ? (
        <Section title="Inbox" action="Organize" actionHref="/inbox" className="mt-4">
          {/*
            The one deliberate emphasis on Home: the Inbox is the only thing here
            asking the user to do something, so it gets the accent tile and the
            accent-soft icon — the same sentence the rest of the app says about
            the current thing — while the rows around it stay quiet.
          */}
          <Link href="/inbox" className="tap card mx-4 flex items-center gap-3 px-4 py-3.5 active:bg-surface-2">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <InboxIcon size={19} strokeWidth={1.9} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-row block font-semibold text-fg">
                {pluralize(inbox.length, 'link')} waiting to be filed
              </span>
              <span className="text-meta mt-0.5 block truncate text-muted">
                {inbox
                  .slice(0, 2)
                  .map((link) => link.title?.trim() || link.source || link.url)
                  .join(' · ')}
                {inbox.length > 2 ? ` +${inbox.length - 2} more` : ''}
              </span>
            </span>
            <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-subtle" aria-hidden />
          </Link>
        </Section>
      ) : null}

      {isEmpty ? (
        <>
          <EmptyState
            icon={<LogoMark size={22} />}
            title="Nothing saved yet"
            description="Stash is a quiet place for the links and notes you mean to keep. Everything lives on this device — no account, no cloud, nothing to sync."
          />
          {/*
            Two things a new user has to know, said as two rows rather than a
            numbered manual: where links come from, and that nothing has to be
            filed. The + button and the share flow are the whole product, so this
            is the only onboarding there is.
          */}
          <GroupSurface className="mt-2">
            <div className="flex items-start gap-3 px-4 py-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <Share2 size={19} strokeWidth={1.9} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-row font-medium text-fg">Save a link from any app</p>
                <p className="text-meta mt-0.5 leading-relaxed text-muted">
                  Tap Share in the app you are reading in and choose Stash. The link arrives in your Inbox.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 px-4 py-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
                <FolderPlus size={19} strokeWidth={1.9} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-row font-medium text-fg">Or add one by hand</p>
                <p className="text-meta mt-0.5 leading-relaxed text-muted">
                  The + button saves a link without filing it. Folders can wait.
                </p>
              </div>
            </div>
          </GroupSurface>
        </>
      ) : (
        <>
          <Section title="Recent" action="See all" actionHref="/search">
            {recent.length > 0 ? (
              <ListSurface>
                {recent.map((link) => (
                  <LinkRow
                    key={link.id}
                    link={link}
                    context={folderNameFor(folders, link.folderId)}
                    onOpen={() => openLink(link)}
                    onToggleFavorite={() => void toggleLinkFavorite(link.id)}
                    onShowActions={() => setActiveLink(link)}
                  />
                ))}
              </ListSurface>
            ) : (
              <p className="text-body px-4 py-4 text-muted">Nothing here yet.</p>
            )}
          </Section>

          {favoriteFolders.length > 0 ? (
            <Section title="Favorite folders">
              {/*
                Soft chips, not bordered pills: no outline, no star repeating the
                section heading, just a warm surface someone can hit with a thumb.
                Favourite folders are the one place on Home where a set of short
                names wraps instead of forming a list, and a chip is the shape
                that says "tap me" without drawing a box.
              */}
              <div className="flex flex-wrap gap-2 px-4">
                {favoriteFolders.map((folder) => (
                  <Link
                    key={folder.id}
                    href={`/library?folder=${folder.id}`}
                    className="tap text-body bg-surface-2 rounded-full px-3.5 py-2 font-medium text-fg active:bg-surface-3"
                  >
                    {folder.name}
                  </Link>
                ))}
              </div>
            </Section>
          ) : null}

          {favorites.length > 0 || favoriteNotes.length > 0 ? (
            <Section title="Favorites" action="All favorites" actionHref="/search?filter=favorites">
              <ListSurface>
                {favorites.map((link) => (
                  <LinkRow
                    key={link.id}
                    link={link}
                    context={folderNameFor(folders, link.folderId)}
                    onOpen={() => openLink(link)}
                    onToggleFavorite={() => void toggleLinkFavorite(link.id)}
                    onShowActions={() => setActiveLink(link)}
                  />
                ))}
                {favoriteNotes.slice(0, 2).map((note) => (
                  <NoteRow
                    key={note.id}
                    note={note}
                    onOpen={() => router.push(`/notes?note=${note.id}`)}
                    onShowActions={() => setActiveNote(note)}
                  />
                ))}
              </ListSurface>
            </Section>
          ) : null}

          {tags.length > 0 ? (
            <Section title="Tags" action="Search" actionHref="/search">
              <div className="scroll-area flex flex-wrap gap-2 overflow-x-auto px-4">
                {tags.slice(0, 12).map((tag) => (
                  <Link
                    key={tag.name}
                    href={`/search?q=${encodeURIComponent(tag.name)}`}
                    className="tap text-body bg-surface-2 flex shrink-0 items-baseline gap-1.5 rounded-full px-3.5 py-2 font-medium text-fg active:bg-surface-3"
                  >
                    <span>
                      <span className="text-subtle">#</span>
                      {tag.name}
                    </span>
                    <span className="text-meta text-subtle">{tag.count}</span>
                  </Link>
                ))}
              </div>
            </Section>
          ) : null}

          <Section title="Folders" action="Library" actionHref="/library" className="pb-6">
            {roots.length > 0 ? (
              <ListSurface>
                {roots.map((folder) => {
                  const stats = folderStats.get(folder.id);
                  return (
                    <FolderRow
                      key={folder.id}
                      folder={folder}
                      linkCount={(stats?.directLinks ?? 0) + (stats?.nestedLinks ?? 0)}
                      childCount={stats?.directChildren ?? 0}
                      onOpen={() => router.push(`/library?folder=${folder.id}`)}
                      onShowActions={() => setActiveFolder(folder)}
                    />
                  );
                })}
              </ListSurface>
            ) : (
              <div className="px-4">
                <EmptyState
                  icon={<FolderPlus size={20} strokeWidth={1.8} />}
                  title="No folders yet"
                  description="Folders keep saved links findable later. Create one now, or let a capture make it."
                  action={
                    <Button asChild variant="accentSoft" size="sm">
                      <Link href="/library">Go to Library</Link>
                    </Button>
                  }
                />
              </div>
            )}

            {/*
              Two ways out of Home, as two rows on one card. They used to be
              dashed-outline buttons, which read as wireframe: a dashed border is
              what a design tool draws for "something goes here".
            */}
            <GroupSurface className="mt-3">
              <Link href="/inbox" className="tap flex items-center gap-3 px-4 py-3.5 active:bg-surface-2">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
                  <InboxIcon size={19} strokeWidth={1.9} aria-hidden />
                </span>
                <span className="text-row min-w-0 flex-1 truncate font-medium text-fg">Inbox</span>
                <span className="text-meta shrink-0 text-muted">
                  {inbox.length > 0 ? pluralize(inbox.length, 'link') : 'Empty'}
                </span>
                <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-subtle" aria-hidden />
              </Link>
              <Link href="/library" className="tap flex items-center gap-3 px-4 py-3.5 active:bg-surface-2">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
                  <FolderPlus size={19} strokeWidth={1.9} aria-hidden />
                </span>
                <span className="text-row min-w-0 flex-1 truncate font-medium text-fg">Browse folders</span>
                <span className="text-meta shrink-0 text-muted">{folders.length}</span>
                <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-subtle" aria-hidden />
              </Link>
            </GroupSurface>
          </Section>
        </>
      )}

      <LinkActionsSheet
        key={activeLink?.id ?? 'no-link'}
        link={activeLink}
        onClose={() => setActiveLink(null)}
      />
      <FolderActionsSheet
        key={activeFolder?.id ?? 'no-folder'}
        folder={activeFolder}
        onClose={() => setActiveFolder(null)}
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

function folderNameFor(folders: readonly Folder[], folderId: string | null): string | undefined {
  if (!folderId) return undefined;
  return folders.find((folder) => folder.id === folderId)?.name;
}
