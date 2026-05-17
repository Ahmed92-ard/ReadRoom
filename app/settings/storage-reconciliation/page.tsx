// app/settings/storage-reconciliation/page.tsx
'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { StorageReconciliationConsole } from '@/components/admin/StorageReconciliationConsole';

export default function StorageReconciliationPage() {
  const router = useRouter();

  const handleBack = () => {
    router.push('/settings');
  };

  const handleExit = () => {
    if (typeof window !== 'undefined') {
      const lastActive = localStorage.getItem('readroom:last-active-room');
      if (lastActive) {
        router.push(lastActive);
        return;
      }
    }
    router.push('/libraries');
  };

  return (
    <StorageReconciliationConsole
      onBack={handleBack}
      onExit={handleExit}
    />
  );
}
