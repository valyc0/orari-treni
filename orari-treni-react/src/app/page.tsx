'use client';
import { AppProvider } from '@/context/AppContext';
import AppShell from '@/components/AppShell';
import { useEffect } from 'react';

export default function Home() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
