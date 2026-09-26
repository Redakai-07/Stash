'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FolderPlus, Inbox, Share2, Sparkles, Star } from 'lucide-react';
import type { Folder, SavedLink } from '@/db/types';
import { childrenOf } from '@/lib/tree';
import { pluralize } from '@/lib/format';
import { openExternal } from '@/lib/open-external';
import { useVaultStore } from '@/stores/vault-store';
import { Button } from '@/components/ui/button';
import { EmptyState, ListSurface, PageHeader, PageTitle, Section } from '@/components/ui/page';
import { LinkRow } from '@/components/links/link-row';
import { LinkActionsSheet } from '@/components/links/link-actions-sheet';
import { FolderRow } from '@/components/folders/folder-row';
import { FolderActionsSheet } from '@/components/folders/folder-actions-sheet';

/**
 * Home answers exactly two questions: what did I save lately, and where do I
 * want to go? No counters-as-dashboard, no streaks, no analytics.
 */
export default function HomePage() {
  const router = useRouter();
  const folders = useVaultStore((state) => state.folders);
  const links = useVaultStore((state) => state.links);
  const folderStats = useVaultStore((state) => state.folderStats);
  const toggleLinkFavorite = useVaultStore((state) => state.toggleLinkFavorite);
  const markLinkOpened = useVaultStore((state) => state.markLinkOpened);

  const [activeLink, setActiveLink] = React.useState<SavedLink | null>(null);
  const [activeFolder, setActiveFolder] = React.useState<Folder | null>(null);

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
  const favoriteFolders = React.useMemo(() => folders.filter((folder) => folder.isFavorite), [folders]);
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
              : `${pluralize(activeLinks.length, 'link')} · ${pluralize(folders.length, 'folder')} · on this device`
          }
        >
          Your vault
        </PageTitle>
      </PageHeader>

      {isEmpty ? (
        <div className="px-4 pt-6">
          <EmptyState
            icon={<Sparkles size={22} strokeWidth={1.7} />}
            title="Start by saving something"
            description="Share a link to Stash from any app, or add one by hand with the + button. Everything stays on this device."
          />
          <div className="mx-auto mt-2 max-w-sm rounded-2xl border border-border bg-surface p-4">
            <p className="flex items-center gap-2 text-[0.9375rem] font-semibold text-fg">
              <Share2 size={17} strokeWidth={1.9} className="text-accent" aria-hidden />
              Save from another app
            </p>
            <ol className="mt-2.5 flex flex-col gap-2 text-[0.8125rem] leading-relaxed text-muted">
              <li>
                <span className="font-medium text-fg">1.</span> Find a video, post or article you want to keep.
              </li>
              <li>
                <span className="font-medium text-fg">2.</span> Tap that app&apos;s Share button.
              </li>
              <li>
                <span className="font-medium text-fg">3.</span> Choose <span className="font-medium text-fg">Stash</span>{' '}
                — the save sheet opens straight away.
              </li>
            </ol>
          </div>
        </div>
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
              <p className="px-4 py-3 text-[0.8125rem] text-muted">Nothing saved yet.</p>
            )}
          </Section>

          {favoriteFolders.length > 0 ? (
            <Section title="Favorite folders">
              <div className="-mx-0 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar">
                {favoriteFolders.map((folder) => (
                  <Link
                    key={folder.id}
                    href={`/library?folder=${folder.id}`}
                    className="tap flex shrink-0 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 active:bg-surface-2"
                  >
                    <Star size={14} strokeWidth={2.2} className="fill-warning text-warning" aria-hidden />
                    <span className="text-[0.875rem] font-medium text-fg">{folder.name}</span>
                  </Link>
                ))}
              </div>
            </Section>
          ) : null}

          {favorites.length > 0 ? (
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
              </ListSurface>
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

            <div className="px-4 pt-2">
              <Link
                href="/library"
                className="tap flex items-center gap-2 rounded-xl border border-dashed border-border-strong px-3 py-2.5 text-[0.875rem] font-medium text-accent active:bg-surface-2"
              >
                <Inbox size={16} strokeWidth={1.9} aria-hidden />
                Open the full folder tree
              </Link>
            </div>
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
    </>
  );
}

function folderNameFor(folders: readonly Folder[], folderId: string | null): string | undefined {
  if (!folderId) return undefined;
  return folders.find((folder) => folder.id === folderId)?.name;
}
