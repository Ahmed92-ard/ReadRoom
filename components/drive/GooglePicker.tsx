'use client';

// GooglePicker.tsx — Unified import dialog.
// Tab A: Google Drive (single PDFs or entire folders via Drive API)
// Tab B: Local device (single files OR entire folders via webkitdirectory)
//
// Folder upload behavior:
//   - Desktop: uses <input webkitdirectory> to select a folder.
//     The browser provides all files inside with their relative paths.
//     We recursively upload all PDFs, preserving folder structure.
//   - Mobile: webkitdirectory is not universally supported.
//     Falls back to multi-file select (accept="application/pdf").

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, Upload, X, HardDrive, FolderPlus, File } from 'lucide-react';
import type { PDFMeta, GoogleDriveFile } from '@/types';

interface GooglePickerProps {
  driveToken: string | null;
  onRequestAccess: () => void;
  /** Called for each Drive PDF selected */
  onSelect: (pdf: PDFMeta) => void | Promise<void>;
  onClose: () => void;
  mode?: 'replace' | 'add';
  libraryId?: string;
  channelId?: string;
  /** Called after a local upload completes — receives the serialized PDF */
  onLocalUploaded?: (pdf: any) => void | Promise<void>;
}

declare global {
  interface Window { gapi?: any; google?: any; }
}

const DEVELOPER_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY!;
const APP_ID        = process.env.NEXT_PUBLIC_GOOGLE_APP_ID!;

type ImportTab = 'drive' | 'local';

interface UploadProgress {
  total: number;
  done: number;
  current: string;
}

export function GooglePicker({
  driveToken,
  onRequestAccess,
  onSelect,
  onClose,
  mode = 'replace',
  libraryId,
  channelId,
  onLocalUploaded,
}: GooglePickerProps) {
  const [gapiReady, setGapiReady]         = useState(false);
  const [pickerError, setPickerError]     = useState<string | null>(null);
  const [activeTab, setActiveTab]         = useState<ImportTab>('drive');
  const [uploading, setUploading]         = useState(false);
  const [progress, setProgress]           = useState<UploadProgress | null>(null);
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // ── Load Google Picker API ────────────────────────────────────────────────
  useEffect(() => {
    const loadScript = (src: string) =>
      new Promise<void>((resolve) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src; s.async = true; s.defer = true;
        s.onload = () => resolve();
        document.body.appendChild(s);
      });

    loadScript('https://apis.google.com/js/api.js').then(() => {
      const wait = () => {
        if (window.gapi?.load) window.gapi.load('picker', () => setGapiReady(true));
        else setTimeout(wait, 100);
      };
      wait();
    });
  }, []);

  // ── Google Drive picker ───────────────────────────────────────────────────
  const openDrivePicker = useCallback(() => {
    if (!gapiReady || !driveToken) return;
    setPickerError(null);

    const pdfView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
      .setMimeTypes('application/pdf')
      .setMode(window.google.picker.DocsViewMode.LIST)
      .setIncludeFolders(true);

    const folderView = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setLabel('Select a folder');

    const builder = new window.google.picker.PickerBuilder()
      .setAppId(APP_ID)
      .setOAuthToken(driveToken)
      .setDeveloperKey(DEVELOPER_KEY)
      .addView(pdfView)
      .addView(new window.google.picker.DocsView().setMimeTypes('application/pdf').setLabel('Shared with me'))
      .addView(folderView)
      .setTitle(mode === 'add' ? 'Select PDFs or a folder' : 'Select a PDF');

    if (window.google.picker.Feature?.MULTI_SELECT_ENABLED) {
      builder.enableFeature(window.google.picker.Feature.MULTI_SELECT_ENABLED);
    }

    builder.setCallback(async (data: any) => {
      if (data.action !== window.google.picker.Action.PICKED) return;
      const docs: GoogleDriveFile[] = data.docs ?? [];
      onClose();
      try {
        for (const doc of docs) {
          if (doc.mimeType === 'application/vnd.google-apps.folder') {
            await importDriveFolder(doc.id, doc.name);
          } else {
            await importDriveFile(doc);
          }
        }
      } catch (err) {
        setPickerError(err instanceof Error ? err.message : String(err));
      }
    }).build().setVisible(true);
  }, [gapiReady, driveToken, mode, onSelect, onClose]);

  const importDriveFile = async (file: GoogleDriveFile) => {
    let thumbnail: string | null = null;
    try {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?fields=thumbnailLink,owners`,
        { headers: { Authorization: `Bearer ${driveToken}` } }
      );
      const meta = await res.json();
      thumbnail = meta.thumbnailLink ?? null;
      file.owners = meta.owners;
    } catch { /* thumbnail optional */ }
    await onSelect({ fileId: file.id, filename: file.name, owner: file.owners?.[0]?.emailAddress ?? 'Unknown', thumbnail, totalPages: null });
  };

  const importDriveFolder = async (folderId: string, folderName: string) => {
    if (!driveToken) return;
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and mimeType='application/pdf' and trashed=false`)}&fields=files(id,name,thumbnailLink,owners)&pageSize=100`,
      { headers: { Authorization: `Bearer ${driveToken}` } }
    );
    if (!res.ok) throw new Error(`Failed to list folder "${folderName}"`);
    const data = await res.json();
    for (const file of (data.files ?? []) as GoogleDriveFile[]) {
      await onSelect({ fileId: file.id, filename: file.name, owner: file.owners?.[0]?.emailAddress ?? 'Unknown', thumbnail: file.thumbnailLink ?? null, totalPages: null });
    }
  };

  // ── Local upload helpers ──────────────────────────────────────────────────

  const uploadFile = async (file: File, folderId?: string | null): Promise<any> => {
    if (!libraryId || !channelId) throw new Error('libraryId and channelId required for local upload');
    const formData = new FormData();
    formData.append('file', file);
    if (folderId) formData.append('folderId', folderId);

    const res = await fetch(`/api/libraries/${libraryId}/channels/${channelId}/pdfs/upload`, {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data.pdf;
  };

  /** Create a folder in the room and return its id */
  const ensureFolder = async (name: string, parentId: string | null): Promise<string> => {
    if (!libraryId || !channelId) throw new Error('libraryId and channelId required');
    const res = await fetch(`/api/libraries/${libraryId}/channels/${channelId}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parentId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create folder');
    return data.folder.id;
  };

  /** Upload a FileList, preserving folder structure via webkitRelativePath */
  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPickerError(null);

    const pdfs = Array.from(files).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );

    if (pdfs.length === 0) {
      setPickerError('No PDF files found in selection.');
      return;
    }

    setUploading(true);
    setProgress({ total: pdfs.length, done: 0, current: '' });

    // Map folder path → folder id (cache to avoid duplicate creates)
    const folderCache = new Map<string, string>();

    const getFolderIdForPath = async (relativePath: string): Promise<string | null> => {
      // relativePath example: "MyFolder/SubFolder/file.pdf"
      const parts = relativePath.split('/');
      if (parts.length <= 1) return null; // root level

      const folderParts = parts.slice(0, -1); // all but filename
      let parentId: string | null = null;

      for (let i = 0; i < folderParts.length; i++) {
        const pathKey = folderParts.slice(0, i + 1).join('/');
        if (folderCache.has(pathKey)) {
          parentId = folderCache.get(pathKey)!;
        } else {
          const folderId = await ensureFolder(folderParts[i], parentId);
          folderCache.set(pathKey, folderId);
          parentId = folderId;
        }
      }
      return parentId;
    };

    try {
      for (let i = 0; i < pdfs.length; i++) {
        const file = pdfs[i];
        setProgress({ total: pdfs.length, done: i, current: file.name });

        const relativePath = (file as any).webkitRelativePath || file.name;
        const folderId = await getFolderIdForPath(relativePath);
        const pdf = await uploadFile(file, folderId);
        if (onLocalUploaded) await onLocalUploaded(pdf);
        else await onSelect({ fileId: pdf.driveId, filename: pdf.filename, owner: 'Local Upload', thumbnail: null, totalPages: null, url: pdf.url });
      }
      setProgress({ total: pdfs.length, done: pdfs.length, current: '' });
      setTimeout(onClose, 400);
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }, [libraryId, channelId, onSelect, onLocalUploaded, onClose]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 rounded-2xl bg-room-surface border border-room-border shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <FolderOpen size={20} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-room-text">
                {mode === 'add' ? 'Add PDFs to this room' : 'Open a PDF'}
              </h2>
              <p className="text-xs text-room-muted">Google Drive or local device</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-room-border mx-6">
          {(['drive', 'local'] as ImportTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab ? 'border-blue-400 text-blue-400' : 'border-transparent text-room-muted hover:text-room-text'
              }`}
            >
              {tab === 'drive' ? <FolderOpen size={15} /> : <HardDrive size={15} />}
              {tab === 'drive' ? 'Google Drive' : 'Local Device'}
            </button>
          ))}
        </div>

        <div className="p-6">
          {pickerError && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {pickerError}
            </div>
          )}

          {/* ── Drive tab ── */}
          {activeTab === 'drive' && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <p className="text-xs text-amber-300">
                  <strong>Privacy:</strong> PDFs are copied into private shared storage. Folder imports add all PDFs inside the folder.
                </p>
              </div>
              {!driveToken ? (
                <button onClick={onRequestAccess} className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl font-medium text-sm bg-white text-gray-900 hover:bg-gray-100 transition-all min-h-[44px]">
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                    <path d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z" fill="#4285F4"/>
                    <path d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z" fill="#34A853"/>
                    <path d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z" fill="#FBBC05"/>
                    <path d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z" fill="#EA4335"/>
                  </svg>
                  Authorize Drive Access
                </button>
              ) : !gapiReady ? (
                <div className="flex items-center justify-center gap-2 py-3 text-room-muted text-sm">
                  <span className="animate-spin w-4 h-4 border-2 border-room-muted border-t-transparent rounded-full" />
                  Loading Google Picker…
                </div>
              ) : (
                <div className="space-y-2">
                  <button onClick={openDrivePicker} className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-sm bg-blue-600 text-white hover:bg-blue-500 transition-all min-h-[44px]">
                    <FolderOpen size={18} />
                    Choose PDFs or Folder from Drive
                  </button>
                  <p className="text-center text-xs text-room-muted">Select individual PDFs or an entire folder</p>
                </div>
              )}
            </div>
          )}

          {/* ── Local tab ── */}
          {activeTab === 'local' && (
            <div className="space-y-3">
              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
                  uploading ? 'border-blue-500/50 bg-blue-500/5 cursor-wait' : 'border-room-border hover:border-blue-500/50 hover:bg-blue-500/5 cursor-pointer'
                }`}
                onClick={() => !uploading && fileInputRef.current?.click()}
              >
                {uploading && progress ? (
                  <div className="space-y-2">
                    <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full mx-auto" />
                    <p className="text-sm text-blue-400 font-medium">
                      {progress.done}/{progress.total} — {progress.current || 'Uploading…'}
                    </p>
                    <div className="w-full bg-room-border rounded-full h-1.5">
                      <div
                        className="bg-blue-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <Upload size={28} className="text-room-muted mx-auto mb-2" />
                    <p className="text-sm font-medium text-room-text mb-1">Drop PDF files here</p>
                    <p className="text-xs text-room-muted">or click to browse • max 100 MB each</p>
                  </>
                )}
              </div>

              {/* Hidden file inputs */}
              {/* Single/multi file picker */}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
              {/* Folder picker — webkitdirectory selects the WHOLE folder */}
              <input
                ref={folderInputRef}
                type="file"
                // @ts-ignore — webkitdirectory is non-standard but widely supported on desktop
                webkitdirectory=""
                directory=""
                multiple
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => !uploading && fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-sm bg-room-bg border border-room-border text-room-text hover:bg-room-hover disabled:opacity-50 transition-all min-h-[44px]"
                >
                  <File size={16} />
                  Select Files
                </button>
                <button
                  onClick={() => !uploading && folderInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-sm bg-room-bg border border-room-border text-room-text hover:bg-room-hover disabled:opacity-50 transition-all min-h-[44px]"
                  title="Select an entire folder — all PDFs inside will be uploaded"
                >
                  <FolderPlus size={16} />
                  Select Folder
                </button>
              </div>
              <p className="text-xs text-room-muted text-center">
                "Select Folder" uploads all PDFs inside, preserving subfolder structure.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
