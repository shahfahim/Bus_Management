import { Accessibility, Armchair } from 'lucide-react';
import type { Seat } from '../types';
import { cx } from './ui';

export function SeatMap({ seats, selected, onSelect }: { seats: Seat[]; selected?: string; onSelect: (seat: Seat) => void }) {
  return (
    <div className="seat-picker">
      <div className="seat-picker__front">
        <span>Driver</span>
        <span className="steering-wheel" />
      </div>
      <div aria-label="Choose a seat" className="seat-grid" role="group">
        {seats.map((seat, index) => {
          const isTeacherSeat = index < 2;
          const unavailable = isTeacherSeat || (seat.status !== 'AVAILABLE' && !seat.heldByCurrentUser);
          return (
            <button
              aria-label={`Seat ${seat.label ?? seat.number}, ${isTeacherSeat ? 'teachers only' : seat.status.toLowerCase()}`}
              aria-pressed={selected === seat.number}
              className={cx(
                'seat',
                isTeacherSeat ? 'seat--blocked' : `seat--${seat.status.toLowerCase()}`,
                !isTeacherSeat && selected === seat.number && 'seat--selected',
                index % 4 === 2 && 'seat--aisle',
              )}
              disabled={unavailable}
              key={seat.number}
              onClick={() => onSelect(seat)}
              type="button"
            >
              {seat.type === 'ACCESSIBLE' ? <Accessibility aria-hidden="true" size={16} /> : <Armchair aria-hidden="true" size={16} />}
              <span>{seat.label ?? seat.number}</span>
            </button>
          );
        })}
      </div>
      <div className="seat-legend">
        <span><i className="seat-key seat-key--available" /> Available</span>
        <span><i className="seat-key seat-key--selected" /> Selected</span>
        <span><i className="seat-key seat-key--booked" /> Booked</span>
        <span><i className="seat-key seat-key--held" /> Held</span>
      </div>
    </div>
  );
}
