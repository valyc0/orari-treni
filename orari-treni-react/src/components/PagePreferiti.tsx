'use client';
import { useAppContext } from '@/context/AppContext';
import { useFavorites } from '@/hooks/useFavorites';

interface Props { showToast: (msg: string) => void; }

export default function PagePreferiti({ showToast }: Props) {
  const { dispatch } = useAppContext();
  const { favorites, removeFavorite, removeRoute } = useFavorites();

  const stations = favorites.filter(f => f.type !== 'route');
  const routes   = favorites.filter(f => f.type === 'route');

  function openStation(id: string, name: string) {
    dispatch({ type: 'SET_STATION', station: { id, name } });
    dispatch({ type: 'SET_PAGE', page: 'orari' });
  }

  function openRoute(fromId: string, fromName: string, toId: string, toName: string) {
    dispatch({ type: 'SET_ROUTE_FROM', station: { id: fromId, name: fromName } });
    dispatch({ type: 'SET_ROUTE_TO',   station: { id: toId,   name: toName   } });
    dispatch({ type: 'SET_PAGE', page: 'itinerario' });
  }

  if (!favorites.length) {
    return (
      <div className="text-center text-muted py-5">
        <i className="bi bi-star" style={{ fontSize: '3.5rem', opacity: .18 }}></i>
        <h6 className="mt-3 fw-semibold">Nessun preferito</h6>
        <p className="small mb-0">Salva stazioni o itinerari con ☆</p>
      </div>
    );
  }

  return (
    <div id="favList">
      {stations.length > 0 && (
        <>
          <div className="px-3 pt-3 pb-1">
            <small className="text-muted fw-semibold text-uppercase" style={{ fontSize: '.7rem', letterSpacing: '.08em' }}>Stazioni</small>
          </div>
          <div className="list-group list-group-flush px-3">
            {stations.map(f => (
              <div key={f.id} className="list-group-item border-0 rounded-3 mb-2 shadow-sm d-flex align-items-center gap-3 py-3"
                style={{ cursor: 'pointer' }} onClick={() => openStation(f.id!, f.name!)}>
                <div className="rounded-3 p-2 flex-shrink-0" style={{ background: '#dbeafe' }}>
                  <i className="bi bi-train-front-fill text-primary fs-4"></i>
                </div>
                <div className="flex-grow-1 overflow-hidden">
                  <div className="fw-bold text-truncate">{f.name}</div>
                  <small className="text-muted">{f.id}</small>
                </div>
                <button className="btn btn-link text-danger p-1 flex-shrink-0"
                  onClick={e => { e.stopPropagation(); removeFavorite(f.id!); showToast('Rimosso dai preferiti'); }}>
                  <i className="bi bi-x-circle-fill fs-5"></i>
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {routes.length > 0 && (
        <>
          <div className="px-3 pt-3 pb-1">
            <small className="text-muted fw-semibold text-uppercase" style={{ fontSize: '.7rem', letterSpacing: '.08em' }}>Itinerari</small>
          </div>
          <div className="list-group list-group-flush px-3 pb-3">
            {routes.map(f => (
              <div key={f.routeKey} className="list-group-item border-0 rounded-3 mb-2 shadow-sm d-flex align-items-center gap-3 py-3"
                style={{ cursor: 'pointer' }}
                onClick={() => openRoute(f.fromId!, f.fromName!, f.toId!, f.toName!)}>
                <div className="rounded-3 p-2 flex-shrink-0" style={{ background: '#dcfce7' }}>
                  <i className="bi bi-signpost-split-fill text-success fs-4"></i>
                </div>
                <div className="flex-grow-1 overflow-hidden">
                  <div className="fw-bold text-truncate">{f.fromName}</div>
                  <div className="d-flex align-items-center gap-1">
                    <i className="bi bi-arrow-down text-muted" style={{ fontSize: '.75rem' }}></i>
                    <span className="text-muted small text-truncate">{f.toName}</span>
                  </div>
                </div>
                <button className="btn btn-link text-danger p-1 flex-shrink-0"
                  onClick={e => { e.stopPropagation(); removeRoute(f.routeKey!); showToast('Itinerario rimosso dai preferiti'); }}>
                  <i className="bi bi-x-circle-fill fs-5"></i>
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
