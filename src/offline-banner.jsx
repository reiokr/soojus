import React, { useEffect, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { t } from './i18n/index.js';

export function useNetworkStatus() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}

export default function OfflineBanner({ online, onRetry }) {
  if (online) return null;
  return <div className="offline-banner" role="status" aria-live="polite">
    <WifiOff size={16}/>
    <span>{t('offline.message')}</span>
    {onRetry && <button type="button" className="text-button" onClick={onRetry}><RefreshCw size={14}/>{t('offline.retry')}</button>}
  </div>;
}
