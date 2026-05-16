'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePDFStore } from '@/store/pdfStore';
import { usePresenceStore } from '@/store/presenceStore';

export function Notes({ roomId }: { roomId: string }) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<number | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const page = usePDFStore((s) => s.page);
  const self = usePresenceStore((s) => s.self);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setConflict(null);

    fetch(`/api/rooms/${roomId}/notes?page=${page}`)
      .then(async (res) => {
        const data = await res.json();
        if (!active) return;
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load notes');
        }
        setNotes(data.content ?? '');
        setNoteId(data.noteId ?? null);
        setLastUpdatedAt(data.updatedAt ?? null);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || 'Unable to load notes.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [roomId, page]);

  const saveNotes = async (content: string, force = false) => {
    if (!self) return;
    setSaving(true);
    setError(null);
    setConflict(null);

    try {
      const response = await fetch(`/api/rooms/${roomId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          pageNum: page,
          userId: self.userId,
          lastUpdatedAt: force ? lastUpdatedAt : lastUpdatedAt,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        if (response.status === 409 && payload.conflict) {
          setConflict(payload.message || 'Another user updated the note. Your draft is preserved.');
          setLastUpdatedAt(payload.serverUpdatedAt ?? lastUpdatedAt);
          return;
        }
        throw new Error(payload.error || 'Unable to save note.');
      }

      setNoteId(payload.note?.id ?? noteId);
      setLastUpdatedAt(payload.note?.updated_at ?? lastUpdatedAt);
    } catch (err) {
      setError((err as Error).message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (val: string) => {
    setNotes(val);
    setConflict(null);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveNotes(val);
    }, 900);
  };

  return (
    <div className="flex flex-col h-full p-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-xs text-room-muted">Note for page {page}</p>
        <div className="flex items-center gap-2">
          {loading && <span className="text-[10px] text-room-muted animate-pulse">Loading…</span>}
          {saving && !loading && <span className="text-[10px] text-room-muted animate-pulse">Saving…</span>}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300 mb-3">
          {error}
        </div>
      )}

      {conflict && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200 mb-3">
          {conflict}
        </div>
      )}

      <textarea
        value={notes}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Jot a quick note about this page…"
        className="flex-1 w-full bg-room-bg border border-room-border rounded-xl p-3 text-sm text-room-text placeholder:text-room-muted outline-none resize-none focus:border-blue-500/50 transition-colors"
      />
    </div>
  );
}
