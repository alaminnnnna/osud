/* Medora — price block: the design's signature moment (DESIGN.md §1).
   Base-unit and sales-unit prices are shown separately and never mixed. */
import { tk } from '@/lib/format';
import type { PriceInfo } from '@/lib/api';

export function PriceBlock({ price, compact = false }: { price: PriceInfo; compact?: boolean }) {
  const salesBase = price.regularSales != null || price.offerSales != null;
  return (
    <div className={compact ? 'mono' : 'mono grid gap-x-6 gap-y-2 sm:grid-cols-2'}>
      {compact ? (
        <>
          {price.hasOffer && price.offerSales != null
            ? <span style={{ color: 'var(--accent)' }}>{tk(price.offerSales)}</span>
            : <span>{tk(price.regularSales)}</span>}
          <span className="text-[11px]" style={{ color: 'var(--fg-3)' }}> /{price.salesUnit ?? 'unit'}</span>
        </>
      ) : (
        <>
          <div>
            <div className="text-[11px]" style={{ color: 'var(--fg-3)' }}>
              Per {price.salesUnit ?? 'sales unit'}
              {price.salesUnitMultiplier != null && price.salesUnitMultiplier > 1 ? ` (${price.salesUnitMultiplier} × ${price.baseUnit ?? 'base unit'})` : ''}
            </div>
            <div className="mt-0.5 flex items-baseline gap-2">
              {price.hasOffer && price.offerSales != null ? (
                <>
                  <span className="text-[28px] leading-none" style={{ color: 'var(--accent)' }}>{tk(price.offerSales)}</span>
                  <span className="text-[14px] line-through" style={{ color: 'var(--fg-3)' }}>{tk(price.regularSales)}</span>
                  {price.discountPercent != null && (
                    <span className="badge" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>−{price.discountPercent}%</span>
                  )}
                </>
              ) : (
                <span className="text-[28px] leading-none">{tk(price.regularSales ?? price.offerSales)}</span>
              )}
            </div>
          </div>
          {salesBase && (price.baseUnit ?? price.regularBase != null) && (
            <div>
              <div className="text-[11px]" style={{ color: 'var(--fg-3)' }}>Per {price.baseUnit ?? 'base unit'}</div>
              <div className="mt-0.5 flex items-baseline gap-2">
                {price.hasOffer && price.offerBase != null ? (
                  <>
                    <span className="text-[20px] leading-none" style={{ color: 'var(--accent)' }}>{tk(price.offerBase)}</span>
                    <span className="text-[13px] line-through" style={{ color: 'var(--fg-3)' }}>{tk(price.regularBase)}</span>
                  </>
                ) : (
                  <span className="text-[20px] leading-none">{tk(price.regularBase ?? price.offerBase)}</span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
