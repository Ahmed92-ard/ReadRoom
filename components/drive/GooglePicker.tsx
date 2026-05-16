'use client';

// LocalFilePicker.tsx (exported as GooglePicker for drop-in compatibility)
//
// ── Multi-folder selection strategy ──────────────────────────────────────────
//
// The OS file dialog opened by <input webkitdirectory> does NOT support
// Ctrl+click to select multiple folders simultaneously — this is a fundamental
// OS-level constraint that no browser can override via HTML input.
//
// TRUE multi-folder selection is implemented using the File System Access API
// (showDirectoryPicker), available in Chromium-based browsers (Chrome, Edge,
// Brave, Opera). The flow:
//   1. User clicks "Select Folders"
//   2. A folder picker opens — user picks the FIRST folder
//   3. Immediately another picker opens — user picks the SECOND folder
//   4. This repeats until the user clicks Cancel (meaning "I'm done")
//   5. All selected folders are uploaded together in one batch
//
// This is the only way to achieve true multi-folder selection without a queue
// system, because the File System Access API is the only browser API that
// allows programmatic re-invocation of the folder picker in a single gesture.
//
// Fallback for Firefox/Safari: single webkitdirectory picker (one folder at a
// time, but still preserves full nested hierarchy).
//
// Drag-and-drop: supports multiple folders dropped simultaneously on all
// browsers via the DataTransferItem.webkitGetAsEntry() API.

import React, { useCallback, useRef, useState } from 'react';
import { Upload, X, FolderPlus, File as FileIcon, AlertCircle, FolderOpen } from 'lucide-react';

interface LocalFilePickerProps {
  onClose: () => void;
  libraryId?: string;
  channelId?: string;
  onLocalUploaded?: (pdf: any) => void | Promise<void>;
  initialFolderId?: string | null;
  onSelect?: (pdf: any) => void | Promise<void>;
  mode?: 'replace' | 'add';
}

interface UploadItem {
  file: File;
  relativePath: string; // e.g. "FolderA/SubFolder/notes.pdf"
}

interface UploadProgress {
  total: number;
  done: number;
  current: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPdf(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function fileBasename(relativePath: string): string {
  return relativePath.split('/').pop() || relativePath;
}

/** Detect File System Access API support (Chromium only) */
function hasFSA(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/** Recursively collect all PDF UploadItems from a FileSystemDirectoryHandle */
async function collectFromDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  pathPrefix = ''
): Promise<UploadItem[]> {
  const items: UploadItem[] = [];
  for await (const [name, entry] of (handle as any).entries()) {
    if (entry.kind === 'file') {
      const file: File = await (entry as FileSystemFileHandle).getFile();
      if (isPdf(file)) {
        items.push({ file, relativePath: `${pathPrefix}${name}` });
      }
    } else if (entry.kind === 'directory') {
      const nested = await collectFromDirectoryHandle(
        entry as FileSystemDirectoryHandle,
        `${pathPrefix}${name}/`
      );
      items.push(...nested);
    }
  }
  return items;
}

/** Recursively collect UploadItems from a DataTransferEntry (drag-and-drop) */
async function collectFromEntry(entry: any, pathPrefix = ''): Promise<UploadItem[]> {
  if (entry.isFile) {
    const file: File = await new Promise((res, rej) => entry.file(res, rej));
    if (!isPdf(file)) return [];
    return [{ file, relativePath: `${pathPrefix}${file.name}` }];
  }
  if (!entry.isDirectory) return [];

  const reader = entry.createReader();
  const allEntries: any[] = [];
  for (;;) {
    const batch: any[] = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (batch.length === 0) break;
    allEntries.push(...batch);
  }
  const nested = await Promise.all(
    allEntries.map((child) => collectFromEntry(child, `${pathPrefix}${entry.name}/`))
  );
  return nested.flat();
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GooglePicker({
  onClose,
  libraryId,
  channelId,
  onLocalUploaded,
  onSelect,
  initialFolderId = null,
}: LocalFilePickerProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // ── Server helpers ────────────────────────────────────────────────────────

  const uploadFile = async (file: File, folderId: string | null, relativePath: string): Promise<any> => {
    if (!libraryId || !channelId) throw new Error('Room context required');
    const formData = new FormData();
    // Use basename only for the filename stored in DB
    formData.append('file', file, fileBasename(relativePath));
    if (folderId) formData.append('folderId', folderId);
    const res = await fetch(
      `/api/libraries/${libraryId}/channels/${channelId}/pdfs/upload`,
      { method: 'POST', body: formData }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    return data.pdf;
  };

  const createFolder = async (name: string, parentId: string | null): Promise<string> => {
    if (!libraryId || !channelId) throw new Error('Room context required');
    const res = await fetch(
      `/api/libraries/${libraryId}/channels/${channelId}/folders`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parentId }),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to create folder');
    return data.folder.id;
  };

  /**
   * Resolve (and create if needed) the folder for a given relative path.
   * folderCache prevents duplicate API calls for the same path within a batch.
   */
  const resolveFolderPath = async (
    relativePath: string,
    folderCache: Map<string, string>
  ): Promise<string | null> => {
    const parts = relativePath.split('/');
    if (parts.length <= 1) return initialFolderId;

    const folderParts = parts.slice(0, -1);
    let parentId: string | null = initialFolderId;

    for (let i = 0; i < folderParts.length; i++) {
      const cacheKey = `${initialFolderId ?? 'root'}:${folderParts.slice(0, i + 1).join('/')}`;
      if (folderCache.has(cacheKey)) {
        parentId = folderCache.get(cacheKey)!;
      } else {
        const id = await createFolder(folderParts[i], parentId);
        folderCache.set(cacheKey, id);
        parentId = id;
      }
    }
    return parentId;
  };

  // ── Core upload batch ─────────────────────────────────────────────────────

  const runUpload = useCallback(async (items: UploadItem[]) => {
    const pdfs = items.filter(({ file }) => isPdf(file));
    if (pdfs.length === 0) {
      setError('No PDF files found in the selection.');
      return;
    }

    setError(null);
    setUploading(true);
    setProgress({ total: pdfs.length, done: 0, current: '' });

    const folderCache = new Map<string, string>();

    try {
      for (let i = 0; i < pdfs.length; i++) {
        const { file, relativePath } = pdfs[i];
        setProgress({ total: pdfs.length, done: i, current: fileBasename(relativePath) });

        const folderId = await resolveFolderPath(relativePath, folderCache);
        const pdf = await uploadFile(file, folderId, relativePath);

        if (onLocalUploaded) await onLocalUploaded(pdf);
        else if (onSelect) await onSelect({ fileId: pdf.driveId, filename: pdf.filename, owner: 'Local Upload', thumbnail: null, totalPages: null, url: pdf.url });
      }

      setProgress({ total: pdfs.length, done: pdfs.length, current: '' });
      setTimeout(onClose, 400);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setUploading(false);
      setProgress(null);
    }
  }, [libraryId, channelId, onLocalUploaded, onSelect, onClose, initialFolderId]);

  // ── Multi-folder via File System Access API (Chromium) ────────────────────
  //
  // Opens folder pickers one after another in a single click handler.
  // Each picker is opened immediately after the previous one closes.
  // When the user cancels (AbortError), we stop and upload everything collected.

  const handleSelectFoldersFSA = useCallback(async () => {
    if (uploading) return;
    const allItems: UploadItem[] = [];

    try {
      // Keep opening pickers until the user cancels
      for (;;) {
        let handle: FileSystemDirectoryHandle;
        try {
          handle = await (window as any).showDirectoryPicker({ mode: 'read' });
        } catch (err: any) {
          // AbortError = user clicked Cancel = they're done selecting
          if (err?.name === 'AbortError') break;
          throw err;
        }

        const items = await collectFromDirectoryHandle(handle, `${handle.name}/`);
        allItems.push(...items);

        // After each folder, immediately open another picker.
        // The browser allows this because we're still within the same user gesture chain.
        // (Each showDirectoryPicker call is awaited synchronously in the loop.)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    if (allItems.length === 0) {
      setError('No PDF files found in the selected folders.');
      return;
    }

    await runUpload(allItems);
  }, [uploading, runUpload]);

  // ── Single-folder fallback (Firefox / Safari / webkitdirectory) ───────────

  const handleFolderInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.currentTarget.value = '';
    if (!files || files.length === 0) return;

    const items: UploadItem[] = Array.from(files).map((file) => ({
      file,
      relativePath: (file as any).webkitRelativePath || file.name,
    }));
    await runUpload(items);
  }, [runUpload]);

  // ── File picker (individual PDFs) ─────────────────────────────────────────

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.currentTarget.value = '';
    if (!files || files.length === 0) return;

    const items: UploadItem[] = Array.from(files).map((file) => ({
      file,
      relativePath: file.name,
    }));
    await runUpload(items);
  }, [runUpload]);

  // ── Drag-and-drop (supports multiple folders on all browsers) ─────────────

  const stopBrowserDrop = useCallback((e: DragEvent | React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (uploading) return;

    const entries = Array.from(e.dataTransfer.items ?? [])
      .map((item) => (item as any).webkitGetAsEntry?.())
      .filter(Boolean);

    let items: UploadItem[];
    if (entries.length > 0) {
      const nested = await Promise.all(entries.map((entry: any) => collectFromEntry(entry)));
      items = nested.flat();
    } else {
      items = Array.from(e.dataTransfer.files).map((file) => ({
        file,
        relativePath: (file as any).webkitRelativePath || file.name,
      }));
    }

    await runUpload(items);
  }, [uploading, runUpload]);

  React.useEffect(() => {
    window.addEventListener('dragover', stopBrowserDrop as any);
    window.addEventListener('drop', stopBrowserDrop as any);
    return () => {
      window.removeEventListener('dragover', stopBrowserDrop as any);
      window.removeEventListener('drop', stopBrowserDrop as any);
    };
  }, [stopBrowserDrop]);

  // ── Render ────────────────────────────────────────────────────────────────

  const useFSA = hasFSA();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onDragEnter={stopBrowserDrop}
      onDragOver={stopBrowserDrop}
      onDrop={handleDrop}
    >
      <div className="relative w-full max-w-md rounded-2xl bg-room-surface border border-room-border shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Upload size={20} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-room-text">Add PDFs</h2>
              <p className="text-xs text-room-muted">
                {initialFolderId ? 'Upload into selected folder' : 'Files, folders, or drag & drop'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={uploading}
            className="p-2 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover transition-colors disabled:opacity-40"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragEnter={stopBrowserDrop}
            onDragOver={stopBrowserDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
              uploading
                ? 'border-blue-500/50 bg-blue-500/5 cursor-wait'
                : 'border-room-border hover:border-blue-500/50 hover:bg-blue-500/5 cursor-pointer'
            }`}
          >
            {uploading && progress ? (
              <div className="space-y-3">
                <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full mx-auto" />
                <p className="text-sm text-blue-400 font-medium">
                  {progress.done}/{progress.total} — {progress.current || 'Uploading…'}
                </p>
                <div className="w-full bg-room-border rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-room-muted">Please wait — do not close this dialog</p>
              </div>
            ) : (
              <>
                <Upload size={32} className="text-room-muted mx-auto mb-3" />
                <p className="text-sm font-medium text-room-text mb-1">
                  Drop PDF files or folders here
                </p>
                <p className="text-xs text-room-muted">
                  {useFSA
                    ? 'Drop multiple folders at once, or use the buttons below'
                    : 'or click to browse your device'}
                </p>
                <p className="text-xs text-room-muted mt-1">Max 100 MB per file</p>
              </>
            )}
          </div>

          {/* Hidden inputs */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />
          {/* Fallback folder input for non-Chromium browsers */}
          <input
            ref={folderInputRef}
            type="file"
            // @ts-ignore
            webkitdirectory=""
            directory=""
            multiple
            className="hidden"
            onChange={handleFolderInputChange}
          />

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => !uploading && fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-wait transition-colors min-h-[44px]"
            >
              <FileIcon size={16} />
              Select Files
            </button>

            {useFSA ? (
              // Chromium: true multi-folder via File System Access API
              <button
                onClick={handleSelectFoldersFSA}
                disabled={uploading}
                className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-medium bg-room-bg border border-room-border text-room-text hover:bg-room-hover disabled:opacity-50 disabled:cursor-wait transition-colors min-h-[44px]"
                title="Pick folders one by one — each picker opens immediately after the previous. Cancel to finish and upload."
              >
                <FolderOpen size={16} />
                Select Folders
              </button>
            ) : (
              // Firefox / Safari: single folder via webkitdirectory
              <button
                onClick={() => !uploading && folderInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-medium bg-room-bg border border-room-border text-room-text hover:bg-room-hover disabled:opacity-50 disabled:cursor-wait transition-colors min-h-[44px]"
                title="Select a folder — all PDFs inside will be uploaded with their subfolder structure"
              >
                <FolderPlus size={16} />
                Select Folder
              </button>
            )}
          </div>

          <p className="text-xs text-room-muted text-center">
            {useFSA
              ? 'Select Folders: each picker opens right after the previous — cancel when done.'
              : 'Folder uploads preserve the full subfolder structure.'}
          </p>
        </div>
      </div>
    </div>
  );
}
