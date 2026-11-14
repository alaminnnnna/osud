/* Medora — loading skeleton (once, subtle shimmer). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
      <div className="skeleton h-8 w-64" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => <div key={i} className="skeleton h-36" />)}
      </div>
    </div>
  );
}
