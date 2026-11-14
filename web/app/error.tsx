/* Medora — route-level error boundary (client). */
'use client';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  console.error('Route error boundary:', error);
  return (
    <div className="card mx-auto mt-10 max-w-md p-8 text-center" role="alert">
      <h1 className="text-[18px] font-medium">Something went wrong</h1>
      <p className="mt-2 text-[13px]" style={{ color: 'var(--fg-2)' }}>
        The backend may be restarting or unreachable. Technical details are logged server-side only.
      </p>
      <button className="btn btn-primary mt-4" onClick={reset}>Try again</button>
    </div>
  );
}
