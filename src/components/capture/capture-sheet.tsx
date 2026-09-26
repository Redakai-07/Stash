'use client';

import * as React from 'react';
import { Check, Copy, FolderPlus, Loader2, Plus, Share2, X } from 'lucide-react';
import type { Folder } from '@/db/types';
import { destinationLabel } from '@/lib/destination';
import { isHttpUrl } from '@/lib/url/normalize';
import { displayUrl } from '@/lib/format';
import { useBackDismiss } from '@/hooks/use-back-dismiss';
import { labelForPackage } from '@/lib/share/types';
import { useCaptureStore } from '@/stores/capture-store';
import { useVaultStore } from '@/stores/vault-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { CreateFolderInline } from './create-folder-inline';
import { DuplicateNotice } from './duplicate-notice';
import { FolderDestinationList } from './folder-destination-list';

/**
 * The Save Sheet.
 *
 * Everything needed to finish a capture lives on this one surface: what was
 * shared, where it is going, and the ability to create a missing folder without
 * leaving. The only ways out are Save or an explicit dismiss, so a share can
 * never be silently dropped.
 */
export function CaptureSheet() {
  const status = useCaptureStore((state) => state.status);
  const mode = useCaptureStore((state) => state.mode);
  const draft = useCaptureStore((state) => state.draft);
  const unreadable = useCaptureStore((state) => state.unreadable);
  const destination = useCaptureStore((state) => state.destination);
  const duplicates = useCaptureStore((state) => state.duplicates);
  const duplicateAcknowledged = useCaptureStore((state) => state.duplicateAcknowledged);
  const saveOtherUrls = useCaptureStore((state) => state.saveOtherUrls);
  const showCreateFolder = useCaptureStore((state) => state.showCreateFolder);
  const folders = useVaultStore((state) => state.folders);

  const [error, setError] = React.useState<string | null>(null);
  const urlInputRef = React.useRef<HTMLInputElement>(null);

  const open = status !== 'idle';

  const close = React.useCallback(() => {
    useCaptureStore.getState().reset();
    setError(null);
  }, []);

  // Android hardware back closes the sheet instead of leaving the app.
  useBackDismiss(open, close);

  const selectDestination = useCaptureStore((state) => state.selectDestination);
  const setShowCreateFolder = useCaptureStore((state) => state.setShowCreateFolder);

  const url = draft?.url.trim() ?? '';
  const validUrl = isHttpUrl(url);
  const duplicatePending = duplicates.length > 0 && !duplicateAcknowledged;

  const handleSave = React.useCallback(async () => {
    setError(null);
    // The notice is already on screen when this happens, so tapping Save is an
    // informed choice to keep a second copy -- not a silent duplicate.
    if (duplicatePending) useCaptureStore.getState().acknowledgeDuplicate();

    const destinationAtSave = useCaptureStore.getState().destination;
    const outcome = await useCaptureStore.getState().save();

    if (outcome.ok) {
      const label = destinationLabel(destinationAtSave, folders);
      const count = outcome.savedCount ?? 1;
      const message = count > 1 ? `Saved ${count} links to ${label}` : `Saved to ${label}`;
      const link = outcome.link;
      toast(message, {
        tone: 'success',
        duration: link ? 6500 : 2600,
        ...(link
          ? {
              action: {
                label: 'Undo',
                onSelect: () => {
                  void useVaultStore.getState().deleteLink(link.id);
                },
              },
            }
          : {}),
      });
      return;
    }

    if (outcome.reason === 'invalid-url') {
      setError('That does not look like a web address. Check it and try again.');
      urlInputRef.current?.focus();
    }
  }, [duplicatePending, folders]);

  const handleMoveExisting = React.useCallback(
    async (linkId: string) => {
      const destinationAtSave = useCaptureStore.getState().destination;
      setError(null);
      await useCaptureStore.getState().moveExisting(linkId);
      toast(`Moved to ${destinationLabel(destinationAtSave, folders)}`, { tone: 'success' });
    },
    [folders],
  );

  const handleOpenExisting = React.useCallback(async (existingUrl: string, linkId: string) => {
    void useVaultStore.getState().markLinkOpened(linkId);
    window.open(existingUrl, '_blank', 'noopener,noreferrer');
    useCaptureStore.getState().reset();
  }, []);

  if (!open) return null;

  return (
    <Sheet open onOpenChange={(next) => !next && close()}>
      <SheetContent
        onOpenAutoFocus={(event) => {
          if (mode === 'manual') {
            event.preventDefault();
            urlInputRef.current?.focus();
          }
        }}
      >
        <SheetHeader>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle>{unreadable ? 'Nothing to save' : mode === 'manual' ? 'Add a link' : 'Save link'}</SheetTitle>
              {!unreadable && mode === 'share' && draft?.appLabel ? (
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-subtle">
                  <Share2 size={12} strokeWidth={2} aria-hidden />
                  Shared from {draft.appLabel}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="tap -mt-0.5 -mr-1.5 flex size-9 shrink-0 items-center justify-center rounded-full text-subtle active:bg-surface-2"
            >
              <X size={19} strokeWidth={2} aria-hidden />
            </button>
          </div>
        </SheetHeader>

        <SheetBody>
          {unreadable ? (
            <UnreadableShare
              rawText={unreadable.rawText}
              appLabel={labelForPackage(unreadable.sourcePackage)}
              onCopied={() => toast('Text copied')}
            />
          ) : draft ? (
            <div className="flex flex-col gap-3 pb-2">
              <LinkPreview
                mode={mode}
                url={draft.url}
                title={draft.title}
                note={draft.note}
                domain={draft.domain}
                sourceLabel={draft.sourceLabel}
                appLabel={draft.appLabel}
                otherUrls={draft.otherUrls}
                saveOtherUrls={saveOtherUrls}
                error={error}
                urlInputRef={urlInputRef}
                onFieldChange={(field, value) => {
                  setError(null);
                  useCaptureStore.getState().setDraftField(field, value);
                }}
                onToggleOthers={(value) => useCaptureStore.getState().setSaveOtherUrls(value)}
              />

              {duplicates.length > 0 && !duplicateAcknowledged ? (
                <DuplicateNotice
                  matches={duplicates}
                  busy={status === 'saving'}
                  onOpenExisting={(match) => void handleOpenExisting(match.link.url, match.link.id)}
                  onMoveExisting={(match) => void handleMoveExisting(match.link.id)}
                  onSaveCopy={() => {
                    useCaptureStore.getState().acknowledgeDuplicate();
                    void handleSave();
                  }}
                  onCancel={close}
                />
              ) : null}

              {showCreateFolder ? (
                <section className="flex flex-col gap-2">
                  <SectionLabel>New folder</SectionLabel>
                  <CreateFolderInline
                    folders={folders}
                    defaultParentId={destination.kind === 'folder' ? destination.folderId : null}
                    onCancel={() => setShowCreateFolder(false)}
                    onCreated={(folder: Folder) => {
                      selectDestination({ kind: 'folder', folderId: folder.id });
                      toast(`Created “${folder.name}”`, { tone: 'success' });
                    }}
                  />
                </section>
              ) : (
                <section className="flex flex-col gap-1.5">
                  <SectionLabel>Save to</SectionLabel>
                  <FolderDestinationList
                    folders={folders}
                    selection={destination}
                    onSelect={selectDestination}
                    showInbox
                    showFavorites
                    footer={
                      <button
                        type="button"
                        onClick={() => setShowCreateFolder(true)}
                        className="tap mt-0.5 flex w-full items-center gap-3 rounded-xl border border-dashed border-border-strong px-3 py-2.5 text-left active:bg-surface-2"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent">
                          <Plus size={17} strokeWidth={2.1} aria-hidden />
                        </span>
                        <span className="text-[0.9375rem] font-medium text-accent">Create folder</span>
                      </button>
                    }
                  />
                </section>
              )}
            </div>
          ) : null}
        </SheetBody>

        <SheetFooter>
          {unreadable ? (
            <Button variant="surface" onClick={close} className="w-full">
              Close
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                disabled={!validUrl || status === 'saving'}
                onClick={() => void handleSave()}
              >
                {status === 'saving' ? (
                  <>
                    <Loader2 size={18} strokeWidth={2.4} className="animate-spin" aria-hidden />
                    Saving…
                  </>
                ) : (
                  <>
                    <Check size={19} strokeWidth={2.5} aria-hidden />
                    {duplicatePending ? 'Save another copy' : 'Save'}
                  </>
                )}
              </Button>
              <p className="mt-2 truncate text-center text-xs text-subtle">
                to <span className="font-medium text-muted">{destinationLabel(destination, folders)}</span>
                {draft && saveOtherUrls && draft.otherUrls.length > 0
                  ? ` · ${draft.otherUrls.length + 1} links`
                  : ''}
              </p>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-3 pt-1 text-[0.6875rem] font-semibold tracking-wider text-subtle uppercase">{children}</h2>
  );
}

interface LinkPreviewProps {
  mode: 'share' | 'manual';
  url: string;
  title: string;
  note: string;
  domain: string;
  sourceLabel?: string;
  appLabel?: string;
  otherUrls: string[];
  saveOtherUrls: boolean;
  error: string | null;
  urlInputRef: React.RefObject<HTMLInputElement | null>;
  onFieldChange: (field: 'url' | 'title' | 'note', value: string) => void;
  onToggleOthers: (value: boolean) => void;
}

/**
 * What is being saved. In share mode this is a compact read-only summary; in
 * manual mode the same card becomes editable, so there is one mental model for
 * both entry points.
 */
function LinkPreview({
  mode,
  url,
  title,
  note,
  domain,
  sourceLabel,
  otherUrls,
  saveOtherUrls,
  error,
  urlInputRef,
  onFieldChange,
  onToggleOthers,
}: LinkPreviewProps) {
  const manual = mode === 'manual';

  return (
    <div className="mx-3 overflow-hidden rounded-xl border border-border bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {sourceLabel ? (
          <span className="inline-flex items-center rounded-md bg-accent-soft px-1.5 py-0.5 text-[0.6875rem] font-semibold text-accent">
            {sourceLabel}
          </span>
        ) : null}
        {domain ? <span className="text-xs text-subtle">{domain}</span> : null}
      </div>

      {manual ? (
        <div className="mt-2 flex flex-col gap-2">
          <Input
            ref={urlInputRef}
            value={url}
            onChange={(event) => onFieldChange('url', event.target.value)}
            placeholder="https://example.com/article"
            aria-label="Link address"
            inputMode="url"
            type="url"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
          />
          <Input
            value={title}
            onChange={(event) => onFieldChange('title', event.target.value)}
            placeholder="Title (optional)"
            aria-label="Title"
            autoComplete="off"
            maxLength={200}
          />
          <Input
            value={note}
            onChange={(event) => onFieldChange('note', event.target.value)}
            placeholder="Note (optional)"
            aria-label="Note"
            maxLength={500}
          />
        </div>
      ) : (
        <div className="mt-1.5">
          {title ? (
            <p className="line-clamp-3 text-[0.9375rem] leading-snug font-medium text-fg">{title}</p>
          ) : (
            <p className="text-[0.9375rem] leading-snug font-medium text-muted">{displayUrl(url, 80)}</p>
          )}
          {note ? <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-snug text-muted">{note}</p> : null}
          {title ? <p className="mt-1 truncate text-xs text-subtle">{displayUrl(url, 72)}</p> : null}
        </div>
      )}

      {error ? (
        <p className="mt-2 rounded-lg bg-danger-soft px-2.5 py-1.5 text-[0.8125rem] leading-snug text-danger">
          {error}
        </p>
      ) : null}

      {otherUrls.length > 0 ? (
        <button
          type="button"
          onClick={() => onToggleOthers(!saveOtherUrls)}
          className={cn(
            'tap mt-2.5 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left',
            saveOtherUrls ? 'border-accent bg-accent-soft' : 'border-border bg-surface',
          )}
        >
          <span
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-md border',
              saveOtherUrls ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong bg-surface',
            )}
            aria-hidden
          >
            {saveOtherUrls ? <Check size={13} strokeWidth={3} /> : null}
          </span>
          <span className="min-w-0 flex-1 text-[0.8125rem] text-fg">
            {saveOtherUrls ? 'Saving' : 'Also save'}{' '}
            {otherUrls.length === 1 ? 'the other link' : `${otherUrls.length} other links`} found in this text
          </span>
        </button>
      ) : null}
    </div>
  );
}

function UnreadableShare({
  rawText,
  appLabel,
  onCopied,
}: {
  rawText: string;
  appLabel?: string;
  onCopied: () => void;
}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      onCopied();
    } catch {
      /* clipboard unavailable: the text is on screen and selectable anyway */
    }
  };

  return (
    <div className="px-3 pb-2">
      <div className="rounded-xl border border-border bg-surface-2 p-3.5">
        <p className="flex items-center gap-2 text-[0.9375rem] font-semibold text-fg">
          <FolderPlus size={17} strokeWidth={1.9} className="text-subtle" aria-hidden />
          No link in this share
        </p>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
          {appLabel ? `${appLabel} sent ` : 'The other app sent '}
          text without a web address. Stash saves links, so there is nothing to file here yet. Your text is
          below and nothing was lost.
        </p>
        {rawText.trim() ? (
          <>
            <pre className="scroll-area mt-3 max-h-48 overflow-auto rounded-lg bg-surface px-3 py-2.5 text-[0.8125rem] leading-relaxed whitespace-pre-wrap break-words text-muted">
              {rawText}
            </pre>
            <button
              type="button"
              onClick={() => void copy()}
              className="tap mt-2.5 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[0.8125rem] font-medium text-accent active:bg-accent-soft"
            >
              <Copy size={14} strokeWidth={2} aria-hidden />
              Copy text
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

