'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Camera, Check, Loader2, UserRound } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { AvatarUpload } from '@/components/ui/AvatarUpload';
import { makeInitials, stringToColor } from '@/lib/utils/avatar';

type AvailabilityState = 'idle' | 'checking' | 'available' | 'taken' | 'error';

function normalizeUsername(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 64);
}

export function ProfileOnboarding() {
  const { user, loading, userName, avatarUrl, profileComplete, updateDisplayName, updateAvatarUrl, refreshProfile } = useAuth();
  const [username, setUsername] = useState('');
  const [availability, setAvailability] = useState<AvailabilityState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAvatarUpload, setShowAvatarUpload] = useState(false);

  const visible = Boolean(user && !loading && !profileComplete);
  const normalized = useMemo(() => normalizeUsername(username), [username]);
  const initials = makeInitials(normalized || userName || 'Reader');
  const color = stringToColor((user?.id ?? normalized) || 'Reader');

  useEffect(() => {
    if (!visible) return;
    setUsername((current) => current || (userName !== 'Reader' ? userName : ''));
    refreshProfile().catch(() => {});
  }, [visible, userName, refreshProfile]);

  useEffect(() => {
    if (!visible) return;
    setMessage(null);

    if (!normalized || normalized.length < 2) {
      setAvailability('idle');
      return;
    }

    setAvailability('checking');
    const controller = new AbortController();
    const id = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/user/username?username=${encodeURIComponent(normalized)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setAvailability('error');
          setMessage(data.error || 'Could not check username');
          return;
        }
        setAvailability(data.available ? 'available' : 'taken');
        setMessage(data.available ? null : 'That username is already taken');
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setAvailability('error');
        setMessage('Could not check username availability');
      }
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(id);
    };
  }, [normalized, visible]);

  const save = async () => {
    if (availability !== 'available') return;
    setSaving(true);
    setMessage(null);
    try {
      const ok = await updateDisplayName(normalized);
      if (!ok) {
        setMessage('Could not save your profile. Please try again.');
        return;
      }
      await refreshProfile().catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  return (
    <>
      <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
        <div className="w-full max-w-md rounded-2xl border border-room-border bg-room-surface shadow-2xl">
          <div className="px-6 pt-6 pb-4 border-b border-room-border">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-300">
                <UserRound size={22} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-room-text">Set up your profile</h2>
                <p className="text-xs text-room-muted">Choose the name people will see in rooms and chat.</p>
              </div>
            </div>
          </div>

          <div className="px-6 py-5 space-y-5">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setShowAvatarUpload(true)}
                className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full ring-2 ring-blue-500/30"
                style={avatarUrl ? {} : { backgroundColor: color }}
                aria-label="Choose profile photo"
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-lg font-bold text-white">{initials}</span>
                )}
                <span className="absolute inset-x-0 bottom-0 flex h-6 items-center justify-center bg-black/50 text-white">
                  <Camera size={13} />
                </span>
              </button>
              <div className="min-w-0">
                <p className="text-sm font-medium text-room-text">Profile photo is optional</p>
                <p className="text-xs text-room-muted">You can skip it now and add one later in settings.</p>
              </div>
            </div>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-room-muted">Username</span>
              <input
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
                className="w-full rounded-xl border border-room-border bg-room-bg px-4 py-3 text-sm text-room-text outline-none transition-colors placeholder:text-room-muted focus:border-blue-500/60"
                placeholder="Choose a username"
                maxLength={64}
              />
            </label>

            <div className="min-h-[20px] text-xs">
              {availability === 'checking' && (
                <span className="inline-flex items-center gap-2 text-room-muted">
                  <Loader2 size={13} className="animate-spin" />
                  Checking availability…
                </span>
              )}
              {availability === 'available' && (
                <span className="inline-flex items-center gap-2 text-green-300">
                  <Check size={13} />
                  Username is available
                </span>
              )}
              {(availability === 'taken' || availability === 'error' || message) && (
                <span className="inline-flex items-center gap-2 text-red-300">
                  <AlertCircle size={13} />
                  {message || 'Choose a different username'}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-room-border px-6 py-4">
            <p className="text-[11px] text-room-muted">Username is required. Photo is optional.</p>
            <button
              onClick={save}
              disabled={saving || availability !== 'available'}
              className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-blue-500 px-5 text-sm font-medium text-white transition-colors hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              Continue
            </button>
          </div>
        </div>
      </div>

      {showAvatarUpload && (
        <AvatarUpload
          currentUrl={avatarUrl}
          currentColor={color}
          currentInitials={initials}
          onUploaded={(url) => { updateAvatarUrl(url); }}
          onClose={() => setShowAvatarUpload(false)}
        />
      )}
    </>
  );
}
