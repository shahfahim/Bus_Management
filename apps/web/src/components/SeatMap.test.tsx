import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Seat } from '../types';
import { SeatMap } from './SeatMap';

const seats: Seat[] = [
  { number: '1', status: 'AVAILABLE', type: 'STANDARD' },
  { number: '2', status: 'BOOKED', type: 'STANDARD' },
  { number: '3', status: 'HELD', type: 'STANDARD' },
  { number: '4', status: 'AVAILABLE', type: 'ACCESSIBLE' },
];

describe('SeatMap', () => {
  it('disables booked and held seats in accessible markup', () => {
    const markup = renderToStaticMarkup(<SeatMap onSelect={() => undefined} seats={seats} />);
    expect(markup).toContain('aria-label="Seat 2, booked"');
    expect(markup).toContain('aria-label="Seat 3, held"');
    expect((markup.match(/disabled=""/g) ?? [])).toHaveLength(2);
  });

  it('exposes the current selection with aria-pressed', () => {
    const markup = renderToStaticMarkup(<SeatMap onSelect={() => undefined} seats={seats} selected="4" />);
    expect(markup).toContain('aria-label="Seat 4, available" aria-pressed="true"');
  });
});
