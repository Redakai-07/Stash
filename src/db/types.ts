/**
 * Persisted entity types.
 *
 * Nesting is always expressed through `parentId`, never by encoding a path
 * into a string such as `"Development/React/Tutorials"`. That choice is what
 * lets folders rename and move without rewriting descendants, and it is why
 * duplicate detection can answer "already saved in Development -> React"
 * without parsing anything.
 */

export interface Folder {
  id: string;
  /** Null means a top-level folder. */
  parentId: string | null;
  name: string;
  /** Lucide icon name, resolved at render time so icons stay declarative. */
  icon?: string;
  createdAt: number;
  updatedAt: number;
  sortOrder: number;
  isFavorite: boolean;
  /** Reserved for Phase 2. Persisted now so no migration is needed later. */
  isLocked: boolean;
}

export interface SavedLink {
  id: string;
  /** Null means the link lives in the Inbox rather than a user folder. */
  folderId: string | null;
  /** The URL exactly as it was captured. Never rewritten. */
  url: string;
  /**
   * Conservative canonical form used only for duplicate detection.
   * Indexed so dedupe is a lookup, not a scan.
   */
  normalizedUrl: string;
  title?: string;
  description?: string;
  userNote?: string;
  /** Domain the link came from, e.g. `youtube.com`. */
  source?: string;
  /** Android package that produced the share, when known. */
  sourcePackage?: string;
  /** Verbatim shared text, preserved for provenance. */
  rawText?: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt?: number;
  isFavorite: boolean;
  isArchived: boolean;
}

export interface Tag {
  id: string;
  name: string;
}

/**
 * A note in the knowledge tree.
 *
 * Structure is expressed by `parentNoteId` exactly as folders use `parentId`.
 * Child notes are never embedded in their parent: a note row stays small and
 * predictable no matter how deep the tree goes, and moving a subtree is a
 * single field update instead of rewriting a nested document.
 */
export interface Note {
  id: string;
  /** Null means a top-level note. */
  parentNoteId: string | null;
  title: string;
  /**
   * Markdown. Kept as plain text so it exports cleanly, renders on any device,
   * and is never locked into an editor's internal document format.
   */
  content: string;
  createdAt: number;
  updatedAt: number;
  sortOrder: number;
  isFavorite: boolean;
  isArchived: boolean;
  /** Reserved: the UI does not gate editing on it yet. */
  isLocked: boolean;
}

/** How a note and a saved link came to be connected. */
export type NoteLinkOrigin = 'created-from' | 'attached';

/**
 * A reference from a note to a saved link.
 *
 * Links are referenced by id rather than copied, so a note points at the one
 * canonical record: editing the link's title or moving it to another folder is
 * reflected everywhere it is referenced, and deleting a note can never delete
 * the link it was thinking about.
 */
export interface NoteLink {
  noteId: string;
  linkId: string;
  /** `created-from` records that the note was born from this link. */
  origin: NoteLinkOrigin;
  createdAt: number;
  sortOrder: number;
}

export interface LinkTag {
  linkId: string;
  tagId: string;
}

/** Single-row-per-key settings store: theme, recents, schema bookkeeping. */
export interface MetaRow {
  key: string;
  value: unknown;
}

export const META_KEYS = {
  themeMode: 'theme.mode',
  recentFolders: 'capture.recentFolders',
  lastFolderId: 'capture.lastFolderId',
  seeded: 'db.seeded',
  schemaInfo: 'db.schemaInfo',
  /** Remembers the last note the user was reading, so Notes reopens in place. */
  lastNoteId: 'notes.lastNoteId',
  /** Collapsed/expanded state is per-device UI state, not vault data. */
  draftNoteId: 'notes.draftId',
} as const;

export interface ExportBundle {
  format: 'stash-export';
  /**
   * 2 added `notes` and `noteLinks`. Version 1 files still import: the note
   * collections are simply absent and are treated as empty.
   */
  version: 1 | 2;
  exportedAt: number;
  folders: Folder[];
  links: SavedLink[];
  tags: Tag[];
  linkTags: LinkTag[];
  notes?: Note[];
  noteLinks?: NoteLink[];
  meta: MetaRow[];
}

/** A note plus the counts needed to describe the cost of deleting it. */
export interface NoteDeletionImpact {
  noteId: string;
  noteTitle: string;
  /** Direct children that would be affected. */
  childNoteCount: number;
  /** Every note below this one. */
  descendantNoteCount: number;
  /** Links referenced by this note or its subtree. Never deleted, only unlinked. */
  referencedLinkCount: number;
  /** Where children go when the user chooses "keep the subnotes". */
  newParentId: string | null;
}

/** A folder plus the counts needed to describe the cost of deleting it. */
export interface FolderDeletionImpact {
  folderId: string;
  folderName: string;
  childFolderCount: number;
  descendantFolderCount: number;
  directLinkCount: number;
  descendantLinkCount: number;
  /** Where contents move when the user chooses "move contents up". */
  newParentId: string | null;
}
