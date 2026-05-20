'use client';

// FolderTree.tsx — Filesystem-style folder/PDF navigation for the room shelf.
// Renders a recursive tree of folders with expandable/collapsible nodes.
// PDFs appear inside their parent folders.

import React, { useState, useCallback } from 'react';
import {
  ChevronRight, ChevronDown, Folder, FolderOpen,
  FileText, Trash2, Pencil, Check, X, FolderInput, Upload,
} from 'lucide-react';
import type { PDFFolder, ChannelPDF } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FolderTreeProps {
  /** Root-level folders (already nested via children[]) */
  folders: PDFFolder[];
  /** PDFs at the root level (no folder) */
  rootPdfs: ChannelPDF[];
  /** Currently active PDF id */
  activePdfId: string | null;
  /** PDF being deleted (shows spinner) */
  deletingPdfId: string | null;
  onSelectPdf: (pdf: ChannelPDF) => void;
  onDeletePdf: (pdf: ChannelPDF) => void;
  onMovePdf: (pdf: ChannelPDF) => void;
  onOpenSideViewer: (pdf: ChannelPDF) => void;
  onDeleteFolder: (folderId: string) => void;
  onUploadToFolder: (folderId: string | null) => void;
  onRenameFolder: (folderId: string, newName: string) => Promise<void>;
  /** Called when a new folder should be created under parentId (null = root) */
  onCreateFolder: (name: string, parentId: string | null) => Promise<void>;
  libraryId?: string;
  channelId?: string;
  onReorderItem?: (type: 'pdf' | 'folder', id: string, newParentId: string | null, newPosition: number) => Promise<void>;
  /** Set of folder IDs that are currently expanded (from localStorage). Absent = default open. */
  expandedFolderIds?: Set<string>;
  /** Called whenever a folder is toggled so the parent can persist the state. */
  onFolderToggle?: (folderId: string, expanded: boolean) => void;
}

// ── PDF row ───────────────────────────────────────────────────────────────────

function PdfRow({
  pdf,
  active,
  deleting,
  depth,
  onSelect,
  onDelete,
  onMove,
  onOpenSide,
}: {
  pdf: ChannelPDF;
  active: boolean;
  deleting: boolean;
  depth: number;
  onSelect: () => void;
  onDelete: () => void;
  onMove: () => void;
  onOpenSide: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'pdf', id: pdf.id }));
      }}
      className={`group flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-sm ${
        active
          ? 'bg-blue-500/15 text-blue-400'
          : 'text-room-muted hover:bg-room-hover hover:text-room-text'
      }`}
      style={{ paddingLeft: `${12 + depth * 16}px` }}
    >
      <FileText size={13} className="flex-shrink-0 opacity-70" />
      <span className="truncate flex-1 min-w-0">{pdf.filename}</span>

      {/* Action buttons — visible on hover */}
      <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onOpenSide(); }}
          className="px-1.5 py-0.5 rounded text-[10px] bg-room-surface text-room-muted hover:text-room-text transition-colors"
          title="Open in side viewer"
        >
          Side
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onMove(); }}
          className="p-1 rounded text-room-muted hover:text-room-text hover:bg-room-surface transition-colors"
          title="Move to folder"
          aria-label={`Move ${pdf.filename}`}
        >
          <FolderInput size={12} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          disabled={deleting}
          className="p-1 rounded text-room-muted hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
          title="Delete PDF"
          aria-label={`Delete ${pdf.filename}`}
        >
          {deleting ? (
            <span className="w-3 h-3 border border-room-muted border-t-transparent rounded-full animate-spin block" />
          ) : (
            <Trash2 size={12} />
          )}
        </button>
      </span>

      {active && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0 shadow-[0_0_6px_rgba(96,165,250,0.6)]" />
      )}
    </div>
  );
}

// ── Folder node ───────────────────────────────────────────────────────────────

function FolderNode({
  folder,
  depth,
  activePdfId,
  deletingPdfId,
  onSelectPdf,
  onDeletePdf,
  onMovePdf,
  onOpenSideViewer,
  onDeleteFolder,
  onUploadToFolder,
  onRenameFolder,
  onCreateFolder,
  onReorderItem,
  expandedFolderIds,
  onFolderToggle,
}: {
  folder: PDFFolder;
  depth: number;
  activePdfId: string | null;
  deletingPdfId: string | null;
  onSelectPdf: (pdf: ChannelPDF) => void;
  onDeletePdf: (pdf: ChannelPDF) => void;
  onMovePdf: (pdf: ChannelPDF) => void;
  onOpenSideViewer: (pdf: ChannelPDF) => void;
  onDeleteFolder: (id: string) => void;
  onUploadToFolder: (folderId: string | null) => void;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onCreateFolder: (name: string, parentId: string | null) => Promise<void>;
  onReorderItem?: (type: 'pdf' | 'folder', id: string, newParentId: string | null, newPosition: number) => Promise<void>;
  expandedFolderIds?: Set<string>;
  onFolderToggle?: (folderId: string, expanded: boolean) => void;
}) {
  // Persisted state uses two sentinels stored in the Set:
  //   "{id}:open"   → was explicitly opened
  //   "{id}:closed" → was explicitly closed
  // If neither sentinel is present the folder is unseen → default to open (true).
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (!expandedFolderIds) return true;
    if (expandedFolderIds.has(folder.id + ':closed')) return false;
    return true; // default open for both explicit :open and unseen folders
  });
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(folder.name);
  const [creatingChild, setCreatingChild] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const totalItems = folder.pdfs.length + folder.children.length;
  const hasActiveChild = folder.pdfs.some((p) => p.id === activePdfId) ||
    folder.children.some((c) => containsActive(c, activePdfId));

  const handleRename = async () => {
    const trimmed = renameDraft.trim();
    if (!trimmed || trimmed === folder.name) { setRenaming(false); return; }
    await onRenameFolder(folder.id, trimmed);
    setRenaming(false);
  };

  const handleCreateChild = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) { setCreatingChild(false); return; }
    await onCreateFolder(trimmed, folder.id);
    setNewFolderName('');
    setCreatingChild(false);
    setExpanded(true);
  };

  return (
    <div>
      {/* Folder header row */}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'folder', id: folder.id }));
          e.stopPropagation();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragOver(false);
          try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            if (data.type === 'folder' && data.id === folder.id) return;
            if (onReorderItem) {
              await onReorderItem(data.type, data.id, folder.id, 0);
            }
          } catch (err) {}
        }}
        className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-all hover:bg-room-hover ${
          isDragOver ? 'bg-blue-500/20 ring-2 ring-blue-500' : ''
        } ${
          hasActiveChild && !expanded ? 'text-blue-400' : 'text-room-text'
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          onFolderToggle?.(folder.id, next);
        }}
      >
        {/* Expand chevron */}
        <span className="flex-shrink-0 text-room-muted">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>

        {/* Folder icon */}
        <span className="flex-shrink-0 text-amber-400">
          {expanded ? <FolderOpen size={14} /> : <Folder size={14} />}
        </span>

        {/* Name or rename input */}
        {renaming ? (
          <input
            autoFocus
            className="flex-1 min-w-0 bg-room-bg border border-blue-500/50 rounded px-1.5 py-0.5 text-xs text-room-text outline-none"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') { setRenaming(false); setRenameDraft(folder.name); }
            }}
            onBlur={handleRename}
          />
        ) : (
          <span className="flex-1 min-w-0 truncate text-sm font-medium">{folder.name}</span>
        )}

        {/* Item count badge */}
        {totalItems > 0 && !renaming && (
          <span className="text-[10px] text-room-muted flex-shrink-0 opacity-60">{totalItems}</span>
        )}

        {/* Folder actions — visible on hover */}
        {!renaming && (
          <span
            className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { setRenameDraft(folder.name); setRenaming(true); }}
              className="p-1 rounded text-room-muted hover:text-room-text hover:bg-room-surface transition-colors"
              title="Rename folder"
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={() => setCreatingChild(true)}
              className="p-1 rounded text-room-muted hover:text-room-text hover:bg-room-surface transition-colors"
              title="New subfolder"
            >
              <Folder size={11} />
            </button>
            <button
              onClick={() => onUploadToFolder(folder.id)}
              className="p-1 rounded text-room-muted hover:text-room-text hover:bg-room-surface transition-colors"
              title="Upload into folder"
            >
              <Upload size={11} />
            </button>
            <button
              onClick={() => onDeleteFolder(folder.id)}
              className="p-1 rounded text-room-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Delete folder"
            >
              <Trash2 size={11} />
            </button>
          </span>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div>
          {/* New subfolder input */}
          {creatingChild && (
            <div
              className="flex items-center gap-1.5 px-2 py-1"
              style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}
            >
              <Folder size={13} className="text-amber-400 flex-shrink-0" />
              <input
                autoFocus
                className="flex-1 min-w-0 bg-room-bg border border-blue-500/50 rounded px-1.5 py-0.5 text-xs text-room-text outline-none"
                placeholder="Folder name…"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateChild();
                  if (e.key === 'Escape') { setCreatingChild(false); setNewFolderName(''); }
                }}
              />
              <button onClick={handleCreateChild} className="p-0.5 text-green-400 hover:text-green-300">
                <Check size={12} />
              </button>
              <button onClick={() => { setCreatingChild(false); setNewFolderName(''); }} className="p-0.5 text-room-muted hover:text-room-text">
                <X size={12} />
              </button>
            </div>
          )}

          {/* Child folders */}
          {folder.children.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              activePdfId={activePdfId}
              deletingPdfId={deletingPdfId}
              onSelectPdf={onSelectPdf}
              onDeletePdf={onDeletePdf}
              onMovePdf={onMovePdf}
              onOpenSideViewer={onOpenSideViewer}
              onDeleteFolder={onDeleteFolder}
              onUploadToFolder={onUploadToFolder}
              onRenameFolder={onRenameFolder}
              onCreateFolder={onCreateFolder}
              onReorderItem={onReorderItem}
              expandedFolderIds={expandedFolderIds}
              onFolderToggle={onFolderToggle}
            />
          ))}

          {/* PDFs in this folder */}
          {folder.pdfs.map((pdf) => (
            <PdfRow
              key={pdf.id}
              pdf={pdf}
              active={pdf.id === activePdfId}
              deleting={pdf.id === deletingPdfId}
              depth={depth + 1}
              onSelect={() => onSelectPdf(pdf)}
              onDelete={() => onDeletePdf(pdf)}
              onMove={() => onMovePdf(pdf)}
              onOpenSide={() => onOpenSideViewer(pdf)}
            />
          ))}

          {/* Empty folder hint */}
          {folder.children.length === 0 && folder.pdfs.length === 0 && !creatingChild && (
            <p
              className="text-[10px] text-room-muted italic py-1"
              style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}
            >
              Empty folder
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Root FolderTree ───────────────────────────────────────────────────────────

export function FolderTree({
  folders,
  rootPdfs,
  activePdfId,
  deletingPdfId,
  onSelectPdf,
  onDeletePdf,
  onMovePdf,
  onOpenSideViewer,
  onDeleteFolder,
  onUploadToFolder,
  onRenameFolder,
  onCreateFolder,
  onReorderItem,
  expandedFolderIds,
  onFolderToggle,
}: FolderTreeProps) {
  const [creatingRoot, setCreatingRoot] = useState(false);
  const [rootFolderName, setRootFolderName] = useState('');
  const [isDragOverRoot, setIsDragOverRoot] = useState(false);

  const handleCreateRoot = async () => {
    const trimmed = rootFolderName.trim();
    if (!trimmed) { setCreatingRoot(false); return; }
    await onCreateFolder(trimmed, null);
    setRootFolderName('');
    setCreatingRoot(false);
  };

  const isEmpty = folders.length === 0 && rootPdfs.length === 0;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOverRoot(true);
      }}
      onDragLeave={() => setIsDragOverRoot(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setIsDragOverRoot(false);
        try {
          const data = JSON.parse(e.dataTransfer.getData('text/plain'));
          if (onReorderItem) {
            await onReorderItem(data.type, data.id, null, 0);
          }
        } catch (err) {}
      }}
      className={`flex flex-col gap-0.5 rounded-lg transition-all ${
        isDragOverRoot ? 'bg-blue-500/5 ring-1 ring-blue-500/20 p-1' : ''
      }`}
    >
      {/* Root folders */}
      {folders.map((folder) => (
        <FolderNode
          key={folder.id}
          folder={folder}
          depth={0}
          activePdfId={activePdfId}
          deletingPdfId={deletingPdfId}
          onSelectPdf={onSelectPdf}
          onDeletePdf={onDeletePdf}
          onMovePdf={onMovePdf}
          onOpenSideViewer={onOpenSideViewer}
          onDeleteFolder={onDeleteFolder}
          onUploadToFolder={onUploadToFolder}
          onRenameFolder={onRenameFolder}
          onCreateFolder={onCreateFolder}
          onReorderItem={onReorderItem}
          expandedFolderIds={expandedFolderIds}
          onFolderToggle={onFolderToggle}
        />
      ))}

      {/* Root-level PDFs (no folder) */}
      {rootPdfs.map((pdf) => (
        <PdfRow
          key={pdf.id}
          pdf={pdf}
          active={pdf.id === activePdfId}
          deleting={pdf.id === deletingPdfId}
          depth={0}
          onSelect={() => onSelectPdf(pdf)}
          onDelete={() => onDeletePdf(pdf)}
          onMove={() => onMovePdf(pdf)}
          onOpenSide={() => onOpenSideViewer(pdf)}
        />
      ))}

      {/* New root folder input */}
      {creatingRoot && (
        <div className="flex items-center gap-1.5 px-2 py-1">
          <Folder size={13} className="text-amber-400 flex-shrink-0" />
          <input
            autoFocus
            className="flex-1 min-w-0 bg-room-bg border border-blue-500/50 rounded px-1.5 py-0.5 text-xs text-room-text outline-none"
            placeholder="Folder name…"
            value={rootFolderName}
            onChange={(e) => setRootFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateRoot();
              if (e.key === 'Escape') { setCreatingRoot(false); setRootFolderName(''); }
            }}
          />
          <button onClick={handleCreateRoot} className="p-0.5 text-green-400 hover:text-green-300">
            <Check size={12} />
          </button>
          <button onClick={() => { setCreatingRoot(false); setRootFolderName(''); }} className="p-0.5 text-room-muted hover:text-room-text">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Empty state */}
      {isEmpty && !creatingRoot && (
        <div className="py-6 text-center">
          <p className="text-xs text-room-muted mb-2">No PDFs yet</p>
          <p className="text-[10px] text-room-muted">Upload files or a folder using the button above</p>
        </div>
      )}

      {/* Create root folder button */}
      {!creatingRoot && (
        <div className="mt-1 flex flex-wrap gap-1">
          <button
            onClick={() => setCreatingRoot(true)}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] text-room-muted hover:text-room-text hover:bg-room-hover transition-colors"
          >
            <Folder size={12} />
            New folder
          </button>
          <button
            onClick={() => onUploadToFolder(null)}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] text-room-muted hover:text-room-text hover:bg-room-hover transition-colors"
          >
            <Upload size={12} />
            Upload here
          </button>
        </div>
      )}
    </div>
  );
}

// ── Helper ────────────────────────────────────────────────────────────────────

function containsActive(folder: PDFFolder, activePdfId: string | null): boolean {
  if (!activePdfId) return false;
  if (folder.pdfs.some((p) => p.id === activePdfId)) return true;
  return folder.children.some((c) => containsActive(c, activePdfId));
}
