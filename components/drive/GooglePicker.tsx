'use client';

// LocalFilePicker.tsx (exported as GooglePicker for drop-in compatibility)
//
// Upload flow:
//   A. Select Files  — individual PDFs, uploaded immediately
//   B. Add Folder    — adds a folder's PDFs to the queue (webkitdirectory)
//      Repeat B as many times as needed, then click Upload All
//   C. Drag & drop   — files or folders, uploaded immediately
//
// Non-PDF files are rejected with an in-app error (no browser alert).
// Folder hierarchy is preserved exactly via webkitRelativePath.

import React, { useCallback, useRef, useState } from 'react';
import { Upload, X, FolderPlus, File as FileIcon, AlertCircle, Trash2 } from 'lucide-react';

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
  relativePath: string;
}

interface UploadProgress {
  total: number;
  done: number;
  current: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function fileBasename(relativePath: string): string {
  return relativePath.split('/').pop() || relativePath;
}

function hasNonPdf(files: File[]): string[] {
  return files.filter((f) => !isPdf(f)).map((f) => f.name);
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
  // Queue: accumulated UploadItems from one or more folder selections
  const [queue, setQueue] = useState<UploadItem[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // ── Core upload batch ─────────────────────────────────────────────────────

  const runUpload = useCallback(async (items: UploadItem[]) => {
    const uploadFile = async (file: File, folderId: string | null, relativePath: string): Promise<any> => {
      if (!libraryId || !channelId) throw new Error('Room context required');
      const formData = new FormData();
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
      setQueue([]);
      setTimeout(onClose, 400);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setUploading(false);
      setProgress(null);
    }
  }, [libraryId, channelId, onLocalUploaded, onSelect, onClose, initialFolderId]);

  // ── File picker handler ───────────────────────────────────────────────────

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.currentTarget.value = '';
    if (!files || files.length === 0) return;

    const allFiles = Array.from(files);
    const nonPdfs = hasNonPdf(allFiles);
    if (nonPdfs.length > 0) {
      setError(`Only PDF files are supported. Remove: ${nonPdfs.slice(0, 3).join(', ')}${nonPdfs.length > 3 ? ` +${nonPdfs.length - 3} more` : ''}`);
      return;
    }

    const items: UploadItem[] = allFiles.map((file) => ({
      file,
      relativePath: file.name,
    }));
    runUpload(items);
  }, [runUpload]);

  // ── Folder picker handler — adds to queue ─────────────────────────────────

  const handleFolderInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.currentTarget.value = '';
    if (!files || files.length === 0) return;

    const items: UploadItem[] = Array.from(files)
      .filter((file) => isPdf(file))
      .map((file) => ({
        file,
        relativePath: (file as any).webkitRelativePath || file.name,
      }));

    if (items.length === 0) {
      setError('No PDF files found in the selected folder.');
      return;
    }

    setError(null);
    setQueue((prev) => [...prev, ...items]);
  }, []);

  // ── Drag-and-drop ─────────────────────────────────────────────────────────

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
      const allFiles = Array.from(e.dataTransfer.files);
      const nonPdfs = hasNonPdf(allFiles);
      if (nonPdfs.length > 0) {
        setError(`Only PDF files are supported. Dropped: ${nonPdfs.slice(0, 3).join(', ')}${nonPdfs.length > 3 ? ` +${nonPdfs.length - 3} more` : ''}`);
        return;
      }
      items = allFiles.map((file) => ({
        file,
        relativePath: (file as any).webkitRelativePath || file.name,
      }));
    }

    if (items.length === 0) {
      setError('No PDF files found in the dropped items.');
      return;
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

  // ── Queue helpers ─────────────────────────────────────────────────────────

  const queuedFolderNames = Array.from(new Set(
    queue.map((item) => item.relativePath.split('/')[0]).filter(Boolean)
  ));

  const clearQueue = () => { setQueue([]); setError(null); };

  // ── Render ────────────────────────────────────────────────────────────────

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
                <p className="text-sm font-medium text-room-text mb-1">Drop PDF files or folders here</p>
                <p className="text-xs text-room-muted">or use the buttons below • PDF files only • max 100 MB each</p>
              </>
            )}
          </div>

          {/* Queue summary */}
          {queue.length > 0 && !uploading && (
            <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2.5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-semibold text-blue-300">
                  {queue.length} PDF{queue.length !== 1 ? 's' : ''} queued from {queuedFolderNames.length} folder{queuedFolderNames.length !== 1 ? 's' : ''}
                </p>
                <button
                  onClick={clearQueue}
                  className="p-0.5 text-room-muted hover:text-red-400 transition-colors"
                  title="Clear queue"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <p className="text-[11px] text-room-muted truncate">
                {queuedFolderNames.join(', ')}
              </p>
            </div>
          )}

          {/* Hidden inputs */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />
          <input
            ref={folderInputRef}
            type="file"
            // @ts-ignore — webkitdirectory is non-standard but widely supported
            webkitdirectory=""
            directory=""
            multiple
            className="hidden"
            onChange={handleFolderInputChange}
          />

          {/* Action buttons */}
          <div className={`grid gap-3 ${queue.length > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <button
              onClick={() => !uploading && fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center justify-center gap-2 py-3 px-3 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-wait transition-colors min-h-[44px]"
            >
              <FileIcon size={15} />
              Select Files
            </button>

            <button
              onClick={() => !uploading && folderInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center justify-center gap-2 py-3 px-3 rounded-xl text-sm font-medium bg-room-bg border border-room-border text-room-text hover:bg-room-hover disabled:opacity-50 disabled:cursor-wait transition-colors min-h-[44px]"
              title="Add a folder to the upload queue — repeat to add more folders, then click Upload"
            >
              <FolderPlus size={15} />
              {queue.length > 0 ? 'Add Folder' : 'Select Folder'}
            </button>

            {queue.length > 0 && (
              <button
                onClick={() => !uploading && runUpload(queue)}
                disabled={uploading}
                className="flex items-center justify-center gap-2 py-3 px-3 rounded-xl text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-wait transition-colors min-h-[44px]"
              >
                <Upload size={15} />
                Upload
              </button>
            )}
          </div>

          <div className="space-y-1 text-center">
            <p className="text-[11px] text-room-muted">
              {queue.length > 0
                ? 'Add more folders or click Upload to start.'
                : 'Add folders one by one to queue them, then upload together.'}
            </p>
            <p className="text-[10px] text-room-muted/80">
              Note: Folder selection supports uploading a single folder. For uploading multiple folders at once, please use drag-and-drop.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
