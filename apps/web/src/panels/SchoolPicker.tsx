/**
 * The school picker. Real buttons in a list, so tab order and Enter/Space come
 * from the platform rather than from hand-rolled key handlers. §7.2
 */

import type { SchoolMeta } from '@canopy/core';

export interface SchoolPickerProps {
  readonly schools: readonly SchoolMeta[];
  readonly selected: string | null;
  readonly onSelect: (slug: string) => void;
}

export function SchoolPicker({ schools, selected, onSelect }: SchoolPickerProps) {
  return (
    <nav aria-label="Schoolyards">
      <div className="section-label" style={{ marginBottom: 'var(--sp-md)' }}>
        SCHOOLYARD
      </div>
      <ul className="picker__list">
        {schools.map((s) => {
          const active = s.slug === selected;
          return (
            <li key={s.slug}>
              <button
                type="button"
                className="picker__item"
                onClick={() => onSelect(s.slug)}
                aria-current={active ? 'true' : undefined}
              >
                <span>{s.name.replace(' Elementary School', ' Elementary')}</span>
                <span className="picker__meta">
                  {s.city}, {s.state} · {s.yardAreaM2.toLocaleString('en-US')} m²
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
