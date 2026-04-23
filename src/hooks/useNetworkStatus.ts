import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

/**
 * Tracks device connectivity. Returns true when the device is online.
 * Subscribes to NetInfo events on mount, unsubscribes on unmount.
 */
export function useNetworkStatus(): { isOnline: boolean } {
  // Default to online so we don't flash an offline banner before the first
  // NetInfo event resolves.
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;
    NetInfo.fetch().then(state => {
      if (!cancelled) setIsOnline(state.isConnected === true);
    });
    const unsub = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected === true);
    });
    return () => { cancelled = true; unsub(); };
  }, []);

  return { isOnline };
}
