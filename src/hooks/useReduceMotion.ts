/**
 * useReduceMotion — OS "hareketi azalt" bayrağını canlı takip eder.
 *
 * Animasyon ekleyen HER yeni bileşen bu hook'u kullanmalı: bayrak açıkken döngülü/giriş
 * animasyonları atlanır, son duruma anında oturulur. (CircularProgress aynı kalıbı kendi
 * içinde taşıyor — davranış birebir aynı; yeni kod tek kopyayı kullansın diye buraya alındı.)
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => { if (active) setReduceMotion(v); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; sub?.remove?.(); };
  }, []);
  return reduceMotion;
}
