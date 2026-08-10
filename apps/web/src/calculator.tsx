import { createContext, useContext, useState, type ReactNode } from "react";

export interface CalculatorItem {
  id: string;
  label: string;
  amount: number;
}

interface CalculatorContextValue {
  items: CalculatorItem[];
  addItem: (amount: number, label: string) => void;
  removeItem: (id: string) => void;
  clear: () => void;
  totalSum: number;
}

const CalculatorContext = createContext<CalculatorContextValue | null>(null);

export function CalculatorProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CalculatorItem[]>([]);

  const addItem = (amount: number, label: string) => {
    const id = crypto.randomUUID();
    setItems((current) => [...current, { id, amount, label }]);
  };

  const removeItem = (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  };

  const clear = () => {
    setItems([]);
  };

  const totalSum = items.reduce((sum, item) => sum + item.amount, 0);

  return (
    <CalculatorContext.Provider
      value={{ items, addItem, removeItem, clear, totalSum }}
    >
      {children}
    </CalculatorContext.Provider>
  );
}

export function useCalculator() {
  const context = useContext(CalculatorContext);
  if (!context) {
    throw new Error("useCalculator must be used within a CalculatorProvider");
  }
  return context;
}
