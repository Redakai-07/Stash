/**
 * Persisted entity types.
 *
 * Nesting is always expressed through `parentId`, never by encoding a path
 * into a string such as `"Development/React/Tutorials"`. That choice is what
 * lets folders rename and move without rewriting descendants, and it is why
 * duplicate detection can answer "already saved in Development -> React"
 * without parsing anything.
 */

/**
 * An authenticated ciphertext produced by the platform's AES-GCM.
 *
 * `ct` is ciphertext *with* the GCM authentication tag appended, so a tampered
 * record fails to decrypt instead of silently returning altered plaintext. The
 * shape carries no key material: the key lives in the keyring, never here.
 */
export interface EncryptedPayload {
  /** Payload format version, so the envelope can evolve without guessing. */
  v: 1;
  /** Always the platform primitive. Stash never defines its own cipher. */
  alg: 'AES-GCM';
  /** Base64 of the random 96-bit nonce. Unique per encryption, never reused. */
  iv: string;
  /** Base64 of ciphertext + authentication tag. */
  ct: string;
}

export interface Folder {
  id: string;
  /** Null means a top-level folder. */
  parentId: string | null;
  /** Blank when the folder is sealed. */
  name: string;
  /** Lucide icon name, resolved at render time so icons stay declarative. */
  icon?: string;
  createdAt: number;
  updatedAt: number;
  sortOrder: number;
  isFavorite: boolean;
  /** Locked against viewing until the session is unlocked. */
  isLocked: boolean;
  /**
   * Sealed `{ name, icon }`. Present exactly when the folder is effectively
   * locked; `name` and `icon` are blanked while it is.
   */
  enc?: EncryptedPayload;
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
  /** Locked against viewing until the session is unlocked. */
  isLocked: boolean;
  /**
   * Sealed `{ url, normalizedUrl, title, description, userNote, rawText,
   * source }`. Present exactly when the link is effectively locked, and those
   * fields are blanked while it is — so a sealed link leaves no address, no
   * title and no snippet behind in the database.
   */
  enc?: EncryptedPayload;
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
  /** Locked against viewing until the session is unlocked. */
  isLocked: boolean;
  /**
   * Sealed `{ title, content }`. Present exactly when the note is effectively
   * locked; both fields are blanked while it is, so an encrypted note cannot
   * leak a title, an opening line or a checklist count.
   */
  enc?: EncryptedPayload;
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

/** Same single-row-per-key shape as `MetaRow`, in its own table on purpose. */
export interface SecurityRow {
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
  /**
   * Non-secret privacy preferences. Deliberately contains no passcode, no key
   * and no verifier: knowing this row tells an attacker nothing they could not
   * learn from the lock screen itself.
   */
  privacySettings: 'privacy.settings',
} as const;

/**
 * Keys for the `security` table.
 *
 * Kept separate from `META_KEYS` because this table is the one place in the app
 * that holds wrapping material, and it is excluded from export, import, the
 * in-memory snapshot and the search index by construction rather than by
 * remembering to filter it.
 */
export const SECURITY_KEYS = {
  keyring: 'privacy.keyring',
} as const;

/**
 * How long the app may sit backgrounded before the unlocked session ends.
 *
 * `immediate` is the secure default: the key is dropped the moment Stash stops
 * being the visible app.
 */
export type RelockPolicy = 'immediate' | '1m' | '5m' | '15m';

export interface PrivacySettings {
  /** True once a keyring exists, i.e. locking content is possible at all. */
  enabled: boolean;
  /** Re-lock policy applied when the app leaves the foreground. */
  relockPolicy: RelockPolicy;
  /**
   * Whether a locked session covers the whole app or only locked items. On by
   * default: it is the behaviour people expect from an app with a passcode.
   */
  lockApp: boolean;
  /** Block screenshots and the recents thumbnail while unlocked. */
  secureScreen: boolean;
  /** Offer the device-biometric fast path in addition to the passcode. */
  biometric: boolean;
}

/**
 * Secure by default: re-lock immediately, gate the whole app, and offer
 * biometrics when the device supports them. Screen privacy is opt-in because it
 * blocks screenshots, which is a real cost most users have not asked for.
 */
export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  enabled: false,
  relockPolicy: 'immediate',
  lockApp: true,
  secureScreen: false,
  biometric: true,
};

/** Wrapped (never raw) key material. Everything here is ciphertext or public. */
export interface KeyringRecord {
  version: 1;
  /** Parameters needed to re-derive the passcode's wrapping key. */
  kdf: {
    algorithm: 'PBKDF2-SHA256';
    /** Base64 salt. Public by design; a salt is not a secret. */
    salt: string;
    iterations: number;
  };
  /** The vault key sealed under the passcode-derived key. The recovery path. */
  wrappedByPasscode: EncryptedPayload;
  /**
   * The vault key sealed under a random key held in Android Keystore-backed
   * storage. The biometric convenience path. Device-bound: never exported.
   */
  wrappedByDevice?: EncryptedPayload;
  createdAt: number;
  updatedAt: number;
}

/** The subset of the keyring that is safe and useful to travel in a backup. */
export interface ExportedKeyring {
  version: 1;
  kdf: KeyringRecord['kdf'];
  wrappedByPasscode: EncryptedPayload;
}

/**
 * A row as it arrives from a backup file.
 *
 * The lock flag is optional here and only here, because that is the truth about
 * the format: a file written by version 1 predates `isLocked` on links entirely,
 * and a file written by version 2 predates notes. Typing the wire format as the
 * internal shape would be a lie that the importer would then have to defend
 * against at runtime; typing it honestly means the default-to-unlocked decision
 * is made in one place, visibly, in `normalize*`.
 */
export type IncomingFolder = Omit<Folder, 'isLocked'> & { isLocked?: boolean };
export type IncomingNote = Omit<Note, 'isLocked'> & { isLocked?: boolean };
export type IncomingLink = Omit<SavedLink, 'isLocked'> & { isLocked?: boolean };

export interface ExportBundle {
  format: 'stash-export';
  /**
   * 2 added `notes` and `noteLinks`. 3 added the privacy keyring envelope and,
   * with it, sealed (`enc`) rows whose secret fields are ciphertext. Version 1
   * files still import: the note collections and keyring are simply absent.
   */
  version: 1 | 2 | 3;
  exportedAt: number;
  folders: IncomingFolder[];
  links: IncomingLink[];
  tags: Tag[];
  linkTags: LinkTag[];
  notes?: IncomingNote[];
  noteLinks?: NoteLink[];
  meta: MetaRow[];
  /**
   * The passcode-wrapped vault key, so a restore on a new device can still be
   * unlocked — with the same passcode. Only ciphertext is ever written here, and
   * the device-bound wrapping is deliberately omitted: it is meaningless off the
   * device that created it.
   */
  security?: { keyring?: ExportedKeyring };
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
