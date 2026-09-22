import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Seat } from '../types';
import { SeatMap } from './SeatMap';

const seats: Seat[] = [
  { number: '1', status: 'BLOCKED', type: 'STANDARD', reserved: true },
  { number: '2', status: 'BLOCKED', type: 'STANDARD', reserved: true },
  { number: '3', status: 'BOOKED', type: 'STANDARD' },
  { number: '4', status: 'HELD', type: 'STANDARD' },
  { number: '5', status: 'AVAILABLE', type: 'ACCESSIBLE' },
];

describe('SeatMap', () => {
  it('disables booked and held seats in accessible markup', () => {
    const markup = renderToStaticMarkup(<SeatMap onSelect={() => undefined} seats={seats} />);
    expect(markup).toContain('aria-label="Seat 3, booked"');
    expect(markup).toContain('aria-label="Seat 4, held"');
    expect((markup.match(/disabled=""/g) ?? [])).toHaveLength(4); // 2 teachers + 1 booked + 1 held
  });

  it('marks API-reserved seats as teachers only, wherever they appear in the list', () => {
    const markup = renderToStaticMarkup(
      <SeatMap
        onSelect={() => undefined}
        seats={[
          { number: '9', status: 'AVAILABLE', type: 'STANDARD' },
          { number: '10', status: 'BLOCKED', type: 'STANDARD', reserved: true },
        ]}
      />,
    );
    expect(markup).toContain('aria-label="Seat 9, available"');
    expect(markup).toContain('aria-label="Seat 10, teachers only"');
  });

  it('exposes the current selection with aria-pressed', () => {
    const markup = renderToStaticMarkup(<SeatMap onSelect={() => undefined} seats={seats} selected="5" />);
    expect(markup).toContain('aria-label="Seat 5, available" aria-pressed="true"');
  });
});
