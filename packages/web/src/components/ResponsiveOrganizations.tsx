import { useEffect, useState } from 'react';
import { Building2, X } from 'lucide-react';
import { OrgStrip } from './OrgStrip';
import './responsive-organizations.css';

/**
 * The actual OrgStrip remains the only organization picker.
 * Desktop: exactly its previous placement and behavior.
 * Small screens: reparent the SAME component into a dismissible overlay,
 * so tables can use the viewport width without losing any nested chips.
 */
export function ResponsiveOrganizations() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  return (
    <>
      <button type="button" className="dash-org-mobile-toggle"
        aria-label="Открыть выбор управлений и организаций"
        aria-expanded={open}
        onClick={() => setOpen(true)}>
        <Building2 size={15} aria-hidden="true"/> Организации
      </button>
      {open && <button type="button" className="dash-org-backdrop"
        onClick={() => setOpen(false)} aria-label="Закрыть выбор организаций"/>}
      <div className={'dash-org-container' + (open ? ' dash-org-container-open' : '')}>
        <div className="dash-org-mobile-head">
          <strong>Управления и организации</strong>
          <button type="button" onClick={() => setOpen(false)}
            aria-label="Закрыть панель организаций"><X size={17} aria-hidden="true"/></button>
        </div>
        <OrgStrip/>
      </div>
    </>
  );
}
