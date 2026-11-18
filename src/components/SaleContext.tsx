'use client';
import { createContext, useContext } from 'react';

// Whether the Black Friday sale is live, decided once on the server in the root
// layout from the same campaign record checkout prices with.
const SaleContext = createContext(false);

export function SaleProvider({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <SaleContext.Provider value={active}>{children}</SaleContext.Provider>;
}

export function useSaleActive() {
  return useContext(SaleContext);
}
