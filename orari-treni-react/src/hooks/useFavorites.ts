'use client';
import { useState, useEffect } from 'react';
import type { Favorite, Station } from '@/lib/types';

const KEY = 'treni_fav';

export function useFavorites() {
  const [favorites, setFavorites] = useState<Favorite[]>([]);

  useEffect(() => {
    try {
      setFavorites(JSON.parse(localStorage.getItem(KEY) || '[]'));
    } catch { setFavorites([]); }
  }, []);

  function save(favs: Favorite[]) {
    setFavorites(favs);
    try { localStorage.setItem(KEY, JSON.stringify(favs)); } catch {}
  }

  function toggleStation(id: string, name: string) {
    const idx = favorites.findIndex(f => f.type !== 'route' && f.id === id);
    if (idx >= 0) {
      save(favorites.filter((_, i) => i !== idx));
      return false;
    } else {
      save([...favorites, { id, name }]);
      return true;
    }
  }

  function toggleRoute(from: Station, to: Station) {
    const routeKey = `${from.id}→${to.id}`;
    const idx = favorites.findIndex(f => f.type === 'route' && f.routeKey === routeKey);
    if (idx >= 0) {
      save(favorites.filter((_, i) => i !== idx));
      return false;
    } else {
      save([...favorites, {
        type: 'route', routeKey,
        fromId: from.id, fromName: from.name,
        toId: to.id, toName: to.name,
      }]);
      return true;
    }
  }

  function removeFavorite(id: string) {
    save(favorites.filter(f => !(f.type !== 'route' && f.id === id)));
  }

  function removeRoute(routeKey: string) {
    save(favorites.filter(f => f.routeKey !== routeKey));
  }

  function isStationFav(id: string) {
    return favorites.some(f => f.type !== 'route' && f.id === id);
  }

  function isRouteFav(fromId: string, toId: string) {
    const routeKey = `${fromId}→${toId}`;
    return favorites.some(f => f.type === 'route' && f.routeKey === routeKey);
  }

  return { favorites, toggleStation, toggleRoute, removeFavorite, removeRoute, isStationFav, isRouteFav };
}
