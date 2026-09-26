'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, FolderPlus, FolderTree, Layers, Star } from 'lucide-react';
import type { Folder, SavedLink } from '@/db/types';
import { breadcrumbOf, childrenOf, descendantIdsOf, folderPathLabel } from '@/lib/tree';
import { pluralize } from '@/lib/format';
import { openExternal } from '@/lib/open-external';
import { useVaultStore } from '@/stores/vault-store';
import { Button } from '@/components/ui/button';
import { EmptyState, ListSurface, PageHeader, Section } from '@/components/ui/page';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { Icon, isIconName } from '@/components/ui/icon';
import { LinkRow } from '@/components/links/link-row';
import { LinkActionsSheet } from '@/components/links/link-actions-sheet';
import { FolderRow } from '@/components/folders/folder-row';
import { FolderActionsSheet } from '@/components/folders/folder-actions-sheet';

/**
 * Library: the folder tree, one level at a time.
 *
 * Unlike the capture sheet (which flattens everything for speed), browsing is
 * deliberately level-by-level: it matches how people think about their own
 * structure, keeps each screen short, and makes the breadcrumb meaningful.
 */
function LibraryView() {
  const router = useRouter();
  const params = useSearchParams();
  const folderParam = params.get('folder');
  const currentId = folderParam && folderParam.length > 0 ? folderParam : null;

  const folders = useVaultStore((state) => state.folders);
  const links = useVaultStore((state) => state.links);
  const folderStats = useVaultStore((state) => state.folderStats);
  const toggleLinkFavorite = useVaultStore((state) => state.toggleLinkFavorite);
  const markLinkOpened = useVaultStore((state) => state.markLinkOpened);

  const [activeLink, setActiveLink] = React.useState<SavedLink | null>(null);
  const [activeFolder, setActiveFolder] = React.useState<Folder | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const currentFolder = currentId ? folders.find((folder) => folder.id === currentId) ?? null : null;
  const trail = React.useMemo(() => (currentId ? breadcrumbOf(folders, currentId) : []), [folders, currentId]);
  const subfolders = React.useMemo(() => childrenOf(folders, currentId), [folders, currentId]);

  const folderLinks = React.useMemo(() => {
    const ids = new Set<string>();
    if (currentId) {
      ids.add(currentId);
      for (const id of descendantIdsOf(folders, currentId)) ids.add(id);
    }
    return links
      .filter((link) => !link.isArchived && (currentId ? link.folderId !== null && ids.has(link.folderId) : true))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [currentId, folders, links]);

  const directLinks = currentId ? folderLinks.filter((link) => link.folderId === currentId) : folderLinks;
  const nestedCount = folderLinks.length - directLinks.length;

  const openLink = React.useCallback(
    (link: SavedLink) => {
      void markLinkOpened(link.id);
      void openExternal(link.url);
    },
    [markLinkOpened],
  );

  const submitNewFolder = async () => {
    const trimmed = newName.trim();
    if (trimmed.length === 0) {
      setCreateError('Give the folder a name.');
      return;
    }
    setBusy(true);
    const result = await useVaultStore.getState().createFolder({ name: trimmed, parentId: currentId });
    setBusy(false);
    if (result.ok) {
      setNewName('');
      setCreating(false);
      setCreateError(null);
      toast(`Created “${result.folder.name}”`, { tone: 'success' });
      return;
    }
    setCreateError(
      result.reason === 'duplicate' ? `“${result.existing.name}” already exists here.` : result.message,
    );
  };

  const totalLinks = folders.length > 0 ? links.filter((link) => !link.isArchived).length : 0;

  return (
    <>
      <PageHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-subtle">
              <Link href="/library" className="tap rounded px-1 py-0.5 active:bg-surface-2">
                Library
              </Link>
              {trail.slice(0, -1).map((folder) => (
                <React.Fragment key={folder.id}>
                  <ChevronRight size={12} strokeWidth={2.2} className="shrink-0 text-subtle" aria-hidden />
                  <Link
                    href={`/library?folder=${folder.id}`}
                    className="tap max-w-[7rem] truncate rounded px-1 py-0.5 active:bg-surface-2"
                  >
                    {folder.name}
                  </Link>
                </React.Fragment>
              ))}
            </nav>
            <div className="mt-1 flex items-center gap-2">
              {currentFolder && isIconName(currentFolder.icon) ? (
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Icon name={currentFolder.icon} size={15} strokeWidth={1.95} />
                </span>
              ) : null}
              <h1 className="truncate text-[1.375rem] leading-tight font-semibold tracking-tight text-fg">
                {currentFolder?.name ?? 'All folders'}
              </h1>
              {currentFolder?.isFavorite ? (
                <Star size={15} strokeWidth={2.2} className="shrink-0 fill-warning text-warning" aria-hidden />
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-[0.8125rem] text-muted">
              {currentId
                ? `${pluralize(directLinks.length, 'link')} here${nestedCount > 0 ? ` · ${nestedCount} below` : ''}${subfolders.length > 0 ? ` · ${pluralize(subfolders.length, 'subfolder')}` : ''}`
                : `${pluralize(folders.length, 'folder')} · ${pluralize(totalLinks, 'link')}`}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {currentFolder ? (
              <>
                <button
                  type="button"
                  onClick={() => setActiveFolder(currentFolder)}
                  aria-label="Folder options"
                  className="tap flex size-10 items-center justify-center rounded-xl text-muted active:bg-surface-2"
                >
                  <Layers size={18} strokeWidth={1.9} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    router.push(currentFolder.parentId ? `/library?folder=${currentFolder.parentId}` : '/library')
                  }
                  aria-label="Go up one level"
                  className="tap flex size-10 items-center justify-center rounded-xl text-muted active:bg-surface-2"
                >
                  <ChevronLeft size={19} strokeWidth={2} aria-hidden />
                </button>
              </>
            ) : null}
            <Button
              variant="accentSoft"
              size="icon"
              aria-label="New folder"
              onClick={() => {
                setCreating(true);
                setCreateError(null);
              }}
            >
              <FolderPlus size={19} strokeWidth={2} aria-hidden />
            </Button>
          </div>
        </div>

        {creating ? (
          <div className="mt-3 flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-2.5">
            <div className="flex items-center gap-2">
              <Input
                value={newName}
                autoFocus
                onChange={(event) => {
                  setNewName(event.target.value);
                  setCreateError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void submitNewFolder();
                  }
                }}
                placeholder={currentFolder ? `New folder inside ${currentFolder.name}` : 'New folder name'}
                aria-label="New folder name"
                enterKeyHint="done"
                maxLength={80}
              />
              <Button variant="primary" size="icon" aria-label="Create folder" onClick={() => void submitNewFolder()} disabled={busy}>
                <FolderPlus size={19} strokeWidth={2.2} aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Cancel"
                onClick={() => {
                  setCreating(false);
                  setNewName('');
                  setCreateError(null);
                }}
              >
                <span className="text-lg leading-none">×</span>
              </Button>
            </div>
            {createError ? (
              <p className="px-1 text-[0.8125rem] text-danger">{createError}</p>
            ) : (
              <p className="px-1 text-xs text-subtle">
                Saves into {currentId ? folderPathLabel(folders, currentId) : 'the top level'}.
              </p>
            )}
          </div>
        ) : null}
      </PageHeader>

      {subfolders.length > 0 ? (
        <Section title="Folders">
          <ListSurface>
            {subfolders.map((folder) => {
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
        </Section>
      ) : null}

      {directLinks.length > 0 ? (
        <Section title={nestedCount > 0 ? 'Links here' : 'Links'}>
          <ListSurface>
            {directLinks.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                onOpen={() => openLink(link)}
                onToggleFavorite={() => void toggleLinkFavorite(link.id)}
                onShowActions={() => setActiveLink(link)}
              />
            ))}
          </ListSurface>
        </Section>
      ) : null}

      {subfolders.length === 0 && directLinks.length === 0 ? (
        <div className="px-4">
          <EmptyState
            icon={<FolderTree size={22} strokeWidth={1.7} />}
            title={currentId ? 'This folder is empty' : 'No folders yet'}
            description={
              currentId
                ? 'Add a subfolder, or share a link from another app and save it here.'
                : 'Create your first folder. Sharing a link into Stash can also create one on the spot.'
            }
            action={
              <Button variant="accentSoft" size="sm" onClick={() => setCreating(true)}>
                <FolderPlus size={16} strokeWidth={2} aria-hidden />
                New folder
              </Button>
            }
          />
        </div>
      ) : null}

      <div className="h-6" />

      <LinkActionsSheet
        key={activeLink?.id ?? 'no-link'}
        link={activeLink}
        onClose={() => setActiveLink(null)}
      />
      <FolderActionsSheet
        key={activeFolder?.id ?? 'no-folder'}
        folder={activeFolder}
        onClose={() => setActiveFolder(null)}
        onDeleted={(folderId) => {
          if (folderId === currentId) router.push('/library');
        }}
      />
    </>
  );
}

export default function LibraryPage() {
  return (
    <React.Suspense fallback={<div className="h-dvh bg-bg" />}>
      <LibraryView />
    </React.Suspense>
  );
}
