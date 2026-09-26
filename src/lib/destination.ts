import type { Folder } from '@/db/types';
import { folderPathLabel } from './tree';

/**
 * Where a capture is going.
 *
 * Two of these are not folders: `inbox` means "file it later" and `favorites`
 * means "file it later, but I want to find it again immediately". Both map onto
 * real fields on the link, so the data model stays honest and no synthetic
 * folders are invented to make the UI simpler.
 */
export type DestinationKind = 'inbox' | 'favorites' | 'folder';

export interface DestinationSelection {
  kind: DestinationKind;
  /** Only meaningful when `kind` is `folder`. */
  folderId: string | null;
}

export const INBOX_DESTINATION: DestinationSelection = { kind: 'inbox', folderId: null };
export const FAVORITES_DESTINATION: DestinationSelection = { kind: 'favorites', folderId: null };

export function folderDestination(folderId: string): DestinationSelection {
  return { kind: 'folder', folderId };
}

export function destinationKey(selection: DestinationSelection): string {
  return selection.kind === 'folder' ? `folder:${selection.folderId ?? ''}` : selection.kind;
}

export function destinationFolderId(selection: DestinationSelection): string | null {
  return selection.kind === 'folder' ? selection.folderId : null;
}

export function destinationIsFavorite(selection: DestinationSelection): boolean {
  return selection.kind === 'favorites';
}

/** Human label for confirmations, e.g. `Development → React` or `Favorites`. */
export function destinationLabel(selection: DestinationSelection, folders: readonly Folder[]): string {
  switch (selection.kind) {
    case 'favorites':
      return 'Favorites';
    case 'inbox':
      return 'Inbox';
    case 'folder':
    default:
      return selection.folderId ? folderPathLabel(folders, selection.folderId) : 'Inbox';
  }
}
