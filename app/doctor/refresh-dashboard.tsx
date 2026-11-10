'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RefreshDashboard() {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [router]);

  return <span className="text-xs text-slate-400">Refreshes every 30 seconds</span>;
}
