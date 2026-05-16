'use client';
import { createContext, useContext, useReducer, ReactNode } from 'react';
import type { ActivePage, Station, NotifThreshold } from '@/lib/types';

interface AppState {
  activePage: ActivePage;
  station: Station | null;
  routeFrom: Station | null;
  routeTo: Station | null;
  routeVia: Station[] | null;
  activeTab: 'partenze' | 'arrivi';
  chosenDate: Date | null;
  autoRefresh: boolean;
  notifThresholds: NotifThreshold[];
}

type Action =
  | { type: 'SET_PAGE'; page: ActivePage }
  | { type: 'SET_STATION'; station: Station }
  | { type: 'SET_ROUTE_FROM'; station: Station | null }
  | { type: 'SET_ROUTE_TO'; station: Station | null }
  | { type: 'SET_ROUTE_VIA'; via: Station[] | null }
  | { type: 'SET_TAB'; tab: 'partenze' | 'arrivi' }
  | { type: 'SET_DATE'; date: Date | null }
  | { type: 'SET_AUTO_REFRESH'; enabled: boolean }
  | { type: 'SET_NOTIF_THRESHOLDS'; thresholds: NotifThreshold[] };

const DEFAULT_THRESHOLDS: NotifThreshold[] = [
  { min: 10, enabled: true },
  { min: 5,  enabled: true },
  { min: 2,  enabled: true },
];

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_PAGE':             return { ...state, activePage: action.page };
    case 'SET_STATION':          return { ...state, station: action.station };
    case 'SET_ROUTE_FROM':       return { ...state, routeFrom: action.station };
    case 'SET_ROUTE_TO':         return { ...state, routeTo: action.station };
    case 'SET_ROUTE_VIA':        return { ...state, routeVia: action.via };
    case 'SET_TAB':              return { ...state, activeTab: action.tab };
    case 'SET_DATE':             return { ...state, chosenDate: action.date };
    case 'SET_AUTO_REFRESH':     return { ...state, autoRefresh: action.enabled };
    case 'SET_NOTIF_THRESHOLDS': return { ...state, notifThresholds: action.thresholds };
    default: return state;
  }
}

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    activePage: 'orari',
    station: null,
    routeFrom: null,
    routeTo: null,
    routeVia: null,
    activeTab: 'partenze',
    chosenDate: null,
    autoRefresh: false,
    notifThresholds: (() => {
      if (typeof window === 'undefined') return DEFAULT_THRESHOLDS;
      try {
        return JSON.parse(localStorage.getItem('notif_thresholds') || 'null') || DEFAULT_THRESHOLDS;
      } catch { return DEFAULT_THRESHOLDS; }
    })(),
  });

  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}
