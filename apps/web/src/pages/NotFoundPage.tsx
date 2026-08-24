import { ArrowLeft, MapPinOff } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="not-found">
      <MapPinOff aria-hidden="true" size={42} />
      <p className="eyebrow">404 · Wrong stop</p>
      <h1>This route doesn’t go here.</h1>
      <p>The page may have moved, or the address may be incomplete.</p>
      <Link className="button button--primary button--md" to="/dashboard"><ArrowLeft aria-hidden="true" size={17} /> Return to dashboard</Link>
    </main>
  );
}
