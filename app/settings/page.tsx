// app/settings/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LogOut, User, Shield, Bell, Palette, Globe } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useUIStore } from '@/store/uiStore';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { AvatarUpload } from '@/components/ui/AvatarUpload';

interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
}

export default function SettingsPage() {
  const router = useRouter();
  const { signOut, updateDisplayName, updateAvatarUrl } = useAuth();
  const { theme, setTheme } = useUIStore();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Settings state
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [showUploadAvatar, setShowUploadAvatar] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [language, setLanguage] = useState('en');
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [privacyPublic, setPrivacyPublic] = useState(true);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await fetch('/api/user/settings');
        if (res.ok) {
          const data = await res.json();
          setProfile(data.profile);
          setNewName(data.profile.display_name);
        }
      } catch (err) {
        console.error('Failed to fetch profile:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const handleUpdateName = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const ok = await updateDisplayName(newName.trim());
      if (ok) {
        setProfile((p) => p ? { ...p, display_name: newName.trim() } : p);
        setEditingName(false);
      }
    } catch (err) {
      console.error('Failed to update name:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUploaded = async (avatarUrl: string) => {
    setProfile((p) => p ? { ...p, avatar_url: avatarUrl } : p);
    setShowUploadAvatar(false);
    await updateAvatarUrl(avatarUrl);
  };

  const handleBack = () => {
    router.back();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-room-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-2 border-room-border border-t-blue-500 animate-spin mx-auto" />
          <p className="text-room-muted mt-4">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-room-bg text-room-text flex flex-col">
      {/* Header */}
      <header className="h-16 border-b border-room-border flex items-center px-6 gap-4 sticky top-0 bg-room-bg/80 backdrop-blur-md z-10">
        <button 
          onClick={handleBack}
          className="p-2 hover:bg-room-hover rounded-full transition-colors text-room-muted hover:text-room-text"
          title="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold tracking-tight">Settings</h1>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full p-6 md:p-10">
        <div className="space-y-12">
          {/* Profile Section */}
          <section>
            <h2 className="text-sm font-semibold text-room-muted uppercase tracking-wider mb-6">Account Profile</h2>
            <div className="bg-room-surface border border-room-border rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-6">
                <div className="relative group">
                  <div className="w-20 h-20 rounded-full bg-blue-600 flex items-center justify-center text-white text-3xl font-bold overflow-hidden">
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                    ) : (
                      profile?.email?.[0].toUpperCase()
                    )}
                  </div>
                  <button
                    onClick={() => setShowUploadAvatar(true)}
                    className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                    title="Change avatar"
                  >
                    <User size={20} className="text-white" />
                  </button>
                </div>

                <div className="flex-1">
                  <div className="mb-4">
                    <label className="text-xs text-room-muted uppercase tracking-wider mb-1 block">Display Name</label>
                    {editingName ? (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          className="flex-1 min-w-0 bg-room-bg border border-room-border rounded-lg px-3 py-2 text-room-text outline-none focus:border-blue-500"
                          placeholder="Your name"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleUpdateName}
                            disabled={saving}
                            className="flex-1 sm:flex-none px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingName(false);
                              setNewName(profile?.display_name || '');
                            }}
                            className="flex-1 sm:flex-none px-4 py-2 border border-room-border text-room-muted hover:text-room-text rounded-lg text-sm transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold">{profile?.display_name || 'Reader'}</h3>
                        <button
                          onClick={() => setEditingName(true)}
                          className="text-xs px-2 py-1 text-room-muted hover:text-room-text hover:bg-room-hover rounded transition-colors"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-room-muted text-sm">{profile?.email}</p>
                </div>
              </div>
            </div>
          </section>

          {/* App Settings */}
          <div className="grid gap-8">
            <SettingsGroup title="App Settings">
              <SettingsItemToggle
                icon={<Palette size={18} />}
                title="Appearance"
                description="Dark theme"
                checked={theme === 'dark'}
                onChange={(checked) => setTheme(checked ? 'dark' : 'light')}
              />
              <SettingsItemToggle
                icon={<Bell size={18} />}
                title="Notifications"
                description="Email and push notifications"
                checked={notifications}
                onChange={setNotifications}
              />
              <div className="w-full flex items-center gap-4 px-6 py-4 border-b border-room-border text-left">
                <div className="w-10 h-10 rounded-xl bg-room-bg flex items-center justify-center text-room-muted">
                  <Globe size={18} />
                </div>
                <div className="flex-1">
                  <h4 className="font-medium text-room-text">Language</h4>
                  <p className="text-xs text-room-muted">Choose your preferred language</p>
                </div>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="rounded-xl border border-room-border bg-room-surface px-3 py-2 text-room-text outline-none"
                >
                  <option value="en">English (US)</option>
                  <option value="es">Español</option>
                  <option value="fr">Français</option>
                </select>
              </div>
            </SettingsGroup>

            <SettingsGroup title="Privacy & Security">
              <SettingsItemToggle
                icon={<Shield size={18} />}
                title="Two-Factor Authentication"
                description="Add an extra layer of security"
                checked={twoFaEnabled}
                onChange={setTwoFaEnabled}
              />
              <SettingsItemToggle
                icon={<User size={18} />}
                title="Privacy"
                description={privacyPublic ? 'Profile is visible to others' : 'Profile is private'}
                checked={privacyPublic}
                onChange={setPrivacyPublic}
              />
            </SettingsGroup>

            <SettingsGroup title="Admin Tools">
              <SettingsItem
                icon={<Shield size={18} />}
                title="Storage Reconciliation"
                description="Scan and clean up orphaned PDF storage files"
                onClick={() => router.push('/settings/storage-reconciliation')}
              />
            </SettingsGroup>
          </div>

          {/* Danger Zone */}
          <section className="pt-6 border-t border-room-border">
            <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wider mb-6">Danger Zone</h2>
            <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="font-bold text-red-400">Sign Out</h3>
                  <p className="text-sm text-room-muted">Disconnect your account from this device.</p>
                </div>
                <button 
                  onClick={() => signOut()}
                  className="flex items-center justify-center gap-2 px-6 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl font-medium transition-all shadow-lg shadow-red-500/20 active:scale-95"
                >
                  <LogOut size={18} />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="p-10 text-center text-xs text-room-muted">
        <p>© 2026 ReadRoom. All rights reserved.</p>
        <p className="mt-1 opacity-50">Version 1.2.0-stable</p>
      </footer>

      {showUploadAvatar && profile && (
        <AvatarUpload
          currentUrl={profile.avatar_url}
          currentColor="#2563eb"
          currentInitials={profile.email?.[0]?.toUpperCase() ?? '?'}
          onUploaded={handleAvatarUploaded}
          onClose={() => setShowUploadAvatar(false)}
        />
      )}
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-room-muted uppercase tracking-wider mb-4">{title}</h2>
      <div className="bg-room-surface border border-room-border rounded-2xl overflow-hidden shadow-sm">
        {children}
      </div>
    </section>
  );
}

function SettingsItem({ icon, title, description, onClick }: { icon: React.ReactNode; title: string; description: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-4 px-6 py-4 hover:bg-room-hover transition-colors text-left border-b border-room-border last:border-0 group">
      <div className="w-10 h-10 rounded-xl bg-room-bg flex items-center justify-center text-room-muted group-hover:text-blue-500 transition-colors">
        {icon}
      </div>
      <div className="flex-1">
        <h4 className="font-medium text-room-text">{title}</h4>
        <p className="text-xs text-room-muted">{description}</p>
      </div>
      <div className="text-room-muted group-hover:translate-x-1 transition-transform opacity-0 group-hover:opacity-100">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    </button>
  );
}

function SettingsItemToggle({ icon, title, description, checked, onChange }: { icon: React.ReactNode; title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className="w-full flex items-center gap-4 px-6 py-4 hover:bg-room-hover transition-colors text-left border-b border-room-border last:border-0">
      <div className="w-10 h-10 rounded-xl bg-room-bg flex items-center justify-center text-room-muted hover:text-blue-500 transition-colors">
        {icon}
      </div>
      <div className="flex-1">
        <h4 className="font-medium text-room-text">{title}</h4>
        <p className="text-xs text-room-muted">{description}</p>
      </div>
      <div className={`w-11 h-6 rounded-full transition-all flex items-center px-1 ${checked ? 'bg-blue-500' : 'bg-room-border'}`}>
        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </div>
    </button>
  );
}
