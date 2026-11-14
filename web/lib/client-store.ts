/* Medora — favourites + compare trays (localStorage; client-side only). */
'use client';

import { useEffect, useState, useCallback } from 'react';

function read(key: string): string[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(window.localStorage.getItem(key) ?? '') as string[]; } catch { return []; }
}
function write(key: string, v: string[]) {
  window.localStorage.setItem(key, JSON.stringify(v));
  window.dispatchEvent(new CustomEvent('medora-store', { detail: key }));
}

export function useList(key: string) {
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => setItems(read(key));
    sync();
    window.addEventListener('medora-store', sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('medora-store', sync); window.removeEventListener('storage', sync); };
  }, [key]);
  const toggle = useCallback((slug: string) => {
    const cur = read(key);
    write(key, cur.includes(slug) ? cur.filter((s) => s !== slug) : [slug, ...cur].slice(0, 40));
  }, [key]);
  const clear = useCallback(() => write(key, []), [key]);
  return { items, toggle, clear };
}

export const FAV_KEY = 'medora.favourites';
export const COMPARE_KEY = 'medora.compare';

export function useFavourites() { return useList(FAV_KEY); }
export function useCompare() { return useList(COMPARE_KEY); }
