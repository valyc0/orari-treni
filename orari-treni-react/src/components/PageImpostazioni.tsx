'use client';
import { useNotifThresholds } from '@/hooks/useNotifThresholds';
import { useNotifications } from '@/hooks/useNotifications';
import type { NotifThreshold } from '@/lib/types';

interface Props { showToast: (msg: string) => void; }

export default function PageImpostazioni({ showToast }: Props) {
  const { thresholds, save, addThreshold, removeThreshold, reset } = useNotifThresholds();
  const { cancelAll } = useNotifications();

  function handleChange(i: number, field: 'min' | 'enabled', val: number | boolean) {
    const updated = thresholds.map((t, idx) =>
      idx === i ? { ...t, [field]: val } : t
    );
    save(updated);
  }

  return (
    <div className="px-3 pt-4">
      <h6 className="fw-bold mb-1">Notifiche di partenza</h6>
      <p className="text-muted small mb-3">Ricevi una notifica X minuti prima della partenza del treno</p>

      <div id="thresholdList">
        {thresholds.map((t: NotifThreshold, i: number) => (
          <div key={i} className="d-flex align-items-center gap-3 mb-3">
            <div className="form-check form-switch mb-0 flex-shrink-0">
              <input className="form-check-input" type="checkbox" role="switch"
                checked={t.enabled}
                onChange={e => handleChange(i, 'enabled', e.target.checked)} />
            </div>
            <div className="input-group input-group-sm" style={{ maxWidth: 120 }}>
              <input type="number" className="form-control" value={t.min} min={1} max={180}
                onChange={e => handleChange(i, 'min', Math.max(1, parseInt(e.target.value) || t.min))} />
              <span className="input-group-text">min</span>
            </div>
            <span className="text-muted small flex-grow-1">prima della partenza</span>
            <button className="btn btn-sm btn-outline-danger px-2"
              onClick={() => removeThreshold(i)} disabled={thresholds.length <= 1}>
              <i className="bi bi-trash"></i>
            </button>
          </div>
        ))}
      </div>

      <button className="btn btn-outline-primary btn-sm me-2 mb-4" onClick={addThreshold}>
        <i className="bi bi-plus-circle me-1"></i>Aggiungi soglia
      </button>
      <button className="btn btn-outline-secondary btn-sm mb-4" onClick={() => { reset(); showToast('Soglie ripristinate ai valori default'); }}>
        <i className="bi bi-arrow-counterclockwise me-1"></i>Ripristina default
      </button>

      <hr />
      <h6 className="fw-bold mb-3">Notifiche attive</h6>
      <button className="btn btn-outline-danger btn-sm"
        onClick={async () => {
          const count = await cancelAll();
          showToast(`${count} notifiche annullate`);
        }}>
        <i className="bi bi-bell-slash me-1"></i>Annulla tutte le notifiche
      </button>

      <hr />
      <div className="text-muted small mt-3">
        <i className="bi bi-info-circle me-1"></i>
        Le notifiche richiedono il permesso del browser e funzionano solo con treni nel pannello countdown aperto.
      </div>
    </div>
  );
}
