'use client';
import React from 'react';
import { Wifi, WifiOff, RefreshCw, Loader2 } from 'lucide-react';
import type { ConnectionStatus } from '@/types';

const config: Record<ConnectionStatus, { label: string; className: string; Icon: any }> = {
  connected:    { label: 'Synced',       className: 'text-emerald-400 bg-emerald-400/10', Icon: Wifi },
  connecting:   { label: 'Connecting',   className: 'text-yellow-400 bg-yellow-400/10',  Icon: Loader2 },
  reconnecting: { label: 'Reconnecting', className: 'text-orange-400 bg-orange-400/10',  Icon: RefreshCw },
  disconnected: { label: 'Offline',      className: 'text-red-400 bg-red-400/10',        Icon: WifiOff },
  error:        { label: 'Error',        className: 'text-red-400 bg-red-400/10',        Icon: WifiOff },
};

export function StatusBadge({ status }: { status: ConnectionStatus }) {
  const cfg = config[status] ?? config['disconnected'];
  const { label, className, Icon } = cfg;
  const spinning = status === 'connecting' || status === 'reconnecting';
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${className}`}>
      <Icon size={12} className={spinning ? 'animate-spin' : ''} />
      <span>{label}</span>
    </div>
  );
}
