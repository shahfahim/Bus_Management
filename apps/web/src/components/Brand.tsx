import { BusFront } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cx } from './ui';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link aria-label="UniRide home" className={cx('brand', compact && 'brand--compact')} to="/dashboard">
      <span className="brand__mark">
        <BusFront aria-hidden="true" size={22} strokeWidth={2.4} />
      </span>
      {!compact && (
        <span>
          <strong>UniRide</strong>
          <small>Campus mobility</small>
        </span>
      )}
    </Link>
  );
}
