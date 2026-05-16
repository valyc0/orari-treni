'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppContext } from '@/context/AppContext';
import SearchPill from './SearchPill';
import PageOrari from './PageOrari';
import PageItinerario from './PageItinerario';
import PagePreferiti from './PagePreferiti';
import PageImpostazioni from './PageImpostazioni';
import TrattaModal from './TrattaModal';
import AIChatPanel from './AIChatPanel';
import type { TrattaCardData } from '@/lib/types';

export default function AppShell() {
  const { state, dispatch } = useAppContext();
  const { activePage } = state;
  const headerRef = useRef<HTMLElement>(null);
  const [trattaData, setTrattaData] = useState<TrattaCardData | null>(null);
  const [trattaOpen, setTrattaOpen] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const adjust = () => {
      if (headerRef.current) {
        const h = headerRef.current.offsetHeight;
        document.documentElement.style.setProperty('--header-h', h + 'px');
        document.body.style.paddingTop = h + 'px';
      }
    };
    adjust();
    const observer = new ResizeObserver(adjust);
    if (headerRef.current) observer.observe(headerRef.current);
    window.addEventListener('resize', adjust);
    return () => { observer.disconnect(); window.removeEventListener('resize', adjust); };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 2600);
  }, []);

  const openTratta = useCallback((data: TrattaCardData) => {
    setTrattaData(data);
    setTrattaOpen(true);
  }, []);

  const setPage = (page: typeof activePage) => dispatch({ type: 'SET_PAGE', page });

  const icons: Record<typeof activePage, string> = {
    orari: 'clock-fill', itinerario: 'signpost-split-fill',
    preferiti: 'star-fill', impostazioni: 'gear-fill',
  };
  const labels: Record<typeof activePage, string> = {
    orari: 'Orari', itinerario: 'Itinerario',
    preferiti: 'Preferiti', impostazioni: 'Impost.',
  };

  return (
    <>
      <header ref={headerRef} id="appHeader" className="app-header fixed-top text-white">
        <div className="px-3 pt-3 pb-3 header-inner">
          <div className="d-flex align-items-baseline gap-2 mb-2">
            <span className="fw-bold fs-5">🚂 Treni Italia</span>
            <small className="opacity-75" id="lastUpdate">Orari in tempo reale</small>
          </div>
          {activePage === 'orari' && (
            <SearchPill showToast={showToast} />
          )}
        </div>
      </header>

      <div className={`app-page${activePage !== 'orari' ? ' d-none' : ''}`} id="pageOrari" style={{ maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
        <PageOrari showToast={showToast} openTratta={openTratta} />
      </div>
      <div className={`app-page${activePage !== 'itinerario' ? ' d-none' : ''}`} id="pageItinerario" style={{ maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
        <PageItinerario showToast={showToast} openTratta={openTratta} active={activePage === 'itinerario'} />
      </div>
      <div className={`app-page${activePage !== 'preferiti' ? ' d-none' : ''}`} id="pagePreferiti" style={{ maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
        <PagePreferiti showToast={showToast} />
      </div>
      <div className={`app-page${activePage !== 'impostazioni' ? ' d-none' : ''}`} id="pageImpostazioni" style={{ maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
        <PageImpostazioni showToast={showToast} />
      </div>

      <nav className="bottom-nav fixed-bottom bg-white border-top d-flex">
        {(['orari', 'itinerario', 'preferiti', 'impostazioni'] as const).map((page) => (
          <button key={page} className={`nav-btn${activePage === page ? ' active' : ''}`} onClick={() => setPage(page)}>
            <i className={`bi bi-${icons[page]} n-icon`}></i>
            <span>{labels[page]}</span>
          </button>
        ))}
      </nav>

      <TrattaModal data={trattaData} open={trattaOpen} onClose={() => setTrattaOpen(false)} showToast={showToast} />
      <AIChatPanel showToast={showToast} />

      <div id="toastWrap" className="position-fixed start-50 translate-middle-x" style={{ zIndex: 9999 }}>
        <div className={`toast align-items-center text-bg-dark border-0 shadow${toast ? ' show' : ''}`} role="alert">
          <div className="d-flex">
            <div className="toast-body fw-medium">{toast}</div>
          </div>
        </div>
      </div>
    </>
  );
}
