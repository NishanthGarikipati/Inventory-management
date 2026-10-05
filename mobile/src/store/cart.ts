import { create } from 'zustand';
import type { CartLine, PaymentMethod, SellableItem } from '../lib/types';

export interface CartTotals {
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  itemCount: number;
}

interface CartState {
  lines: CartLine[];
  customerId: string | null;
  customerName: string | null;
  billDiscountPaise: number;
  note: string;

  add: (item: SellableItem, quantity?: number) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  setPrice: (variantId: string, unitPricePaise: number) => void;
  setLineDiscount: (variantId: string, discountPaise: number) => void;
  setSerials: (variantId: string, serials: string[]) => void;
  remove: (variantId: string) => void;
  setCustomer: (id: string | null, name: string | null) => void;
  setBillDiscount: (paise: number) => void;
  setNote: (note: string) => void;
  clear: () => void;
}

export const useCart = create<CartState>((set) => ({
  lines: [],
  customerId: null,
  customerName: null,
  billDiscountPaise: 0,
  note: '',

  add(item, quantity = 1) {
    set((state) => {
      const existing = state.lines.find((line) => line.variantId === item.variantId);
      if (existing) {
        return {
          lines: state.lines.map((line) =>
            line.variantId === item.variantId
              ? { ...line, quantity: round(line.quantity + quantity) }
              : line,
          ),
        };
      }
      const line: CartLine = {
        variantId: item.variantId,
        name: item.name,
        unit: item.unit,
        allowDecimal: item.allowDecimal,
        quantity: round(quantity),
        unitPricePaise: item.sellingPricePaise,
        mrpPaise: item.mrpPaise,
        discountPaise: 0,
        taxRate: item.taxRate,
        stock: item.stock,
      };
      return { lines: [...state.lines, line] };
    });
  },

  setQuantity(variantId, quantity) {
    set((state) => ({
      lines:
        quantity <= 0
          ? state.lines.filter((line) => line.variantId !== variantId)
          : state.lines.map((line) =>
              line.variantId === variantId ? { ...line, quantity: round(quantity) } : line,
            ),
    }));
  },

  setPrice(variantId, unitPricePaise) {
    set((state) => ({
      lines: state.lines.map((line) =>
        line.variantId === variantId ? { ...line, unitPricePaise: Math.max(0, unitPricePaise) } : line,
      ),
    }));
  },

  setLineDiscount(variantId, discountPaise) {
    set((state) => ({
      lines: state.lines.map((line) =>
        line.variantId === variantId ? { ...line, discountPaise: Math.max(0, discountPaise) } : line,
      ),
    }));
  },

  setSerials(variantId, serials) {
    set((state) => ({
      lines: state.lines.map((line) => (line.variantId === variantId ? { ...line, serials } : line)),
    }));
  },

  remove(variantId) {
    set((state) => ({ lines: state.lines.filter((line) => line.variantId !== variantId) }));
  },

  setCustomer(customerId, customerName) {
    set({ customerId, customerName });
  },

  setBillDiscount(billDiscountPaise) {
    set({ billDiscountPaise: Math.max(0, billDiscountPaise) });
  },

  setNote(note) {
    set({ note });
  },

  clear() {
    set({ lines: [], customerId: null, customerName: null, billDiscountPaise: 0, note: '' });
  },
}));

/**
 * Mirrors the server's bill maths so the counter display matches the receipt.
 * The server stays the authority; this is what the owner watches while typing.
 */
export function cartTotals(
  lines: CartLine[],
  billDiscountPaise: number,
  options: { taxEnabled: boolean; pricesIncludeTax: boolean; roundOff: boolean },
): CartTotals {
  const lineValues = lines.map((line) =>
    Math.max(0, Math.round(line.unitPricePaise * line.quantity) - line.discountPaise),
  );
  const lineTotal = lineValues.reduce((sum, value) => sum + value, 0);
  const spread = allocate(Math.min(billDiscountPaise, lineTotal), lineValues);

  let subtotalPaise = 0;
  let taxPaise = 0;

  lines.forEach((line, index) => {
    const value = Math.max(0, lineValues[index] - spread[index]);
    const rate = options.taxEnabled ? line.taxRate : 0;
    if (rate <= 0) {
      subtotalPaise += value;
      return;
    }
    if (options.pricesIncludeTax) {
      const taxable = Math.round((value * 100) / (100 + rate));
      subtotalPaise += taxable;
      taxPaise += value - taxable;
    } else {
      subtotalPaise += value;
      taxPaise += Math.round((value * rate) / 100);
    }
  });

  const beforeRounding = subtotalPaise + taxPaise;
  const totalPaise = options.roundOff ? Math.round(beforeRounding / 100) * 100 : beforeRounding;

  return {
    subtotalPaise,
    discountPaise: lines.reduce((sum, line) => sum + line.discountPaise, 0) + Math.min(billDiscountPaise, lineTotal),
    taxPaise,
    totalPaise,
    itemCount: lines.length,
  };
}

export const PAYMENT_METHODS: Array<{ code: PaymentMethod; label: string; icon: string }> = [
  { code: 'CASH', label: 'Cash', icon: '💵' },
  { code: 'UPI', label: 'UPI', icon: '📱' },
  { code: 'CARD', label: 'Card', icon: '💳' },
  { code: 'CREDIT', label: 'Credit', icon: '📒' },
  { code: 'OTHER', label: 'Other', icon: '🧾' },
];

const round = (value: number): number => Number(value.toFixed(3));

function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const shares = weights.map((weight) => Math.floor((total * weight) / sum));
  let remainder = total - shares.reduce((acc, share) => acc + share, 0);
  for (let index = 0; remainder > 0 && index < shares.length; index += 1) {
    shares[index] += 1;
    remainder -= 1;
  }
  return shares;
}
