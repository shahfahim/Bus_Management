import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Seat } from '../types';
import { SeatMap } from './SeatMap';

const seats: Seat[] = [
  { number: '1', status: 'AVAILABLE', type: 'STANDARD' },
  { number: '2', status: 'AVAILABLE', type: 'STANDARD' },
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

  it('exposes the current selection with aria-pressed', () => {
    const markup = renderToStaticMarkup(<SeatMap onSelect={() => undefined} seats={seats} selected="5" />);
    expect(markup).toContain('aria-label="Seat 5, available" aria-pressed="true"');
  });
});
