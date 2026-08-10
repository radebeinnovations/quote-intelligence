import { useCalculator } from "../calculator";
import { zar } from "../format";
import { useState, useEffect, useRef } from "react";

export function CalculatorWidget() {
  const { items, removeItem, clear, totalSum } = useCalculator();
  const [isOpen, setIsOpen] = useState(false);
  const prevCount = useRef(items.length);

  useEffect(() => {
    if (items.length > prevCount.current) {
      setIsOpen(true);
    }
    prevCount.current = items.length;
  }, [items.length]);

  return (
    <div className={`calculator-widget ${isOpen ? "open" : "minimized"}`}>
      <div className="calculator-header" onClick={() => setIsOpen(!isOpen)}>
        <h3>Calculator {items.length > 0 && `(${items.length})`}</h3>
        <button
          className="icon-button"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
          title={isOpen ? "Minimize" : "Expand"}
        >
          {isOpen ? "▼" : "▲"}
        </button>
      </div>

      {isOpen && (
        <div className="calculator-body">
          <ul className="calculator-items">
            {items.length === 0 ? (
              <li style={{ justifyContent: "center", padding: "24px 16px", color: "var(--muted)", fontStyle: "italic", fontSize: "0.85rem" }}>
                Click any price to calculate
              </li>
            ) : (
              items.map((item) => (
                <li key={item.id}>
                  <div className="item-details">
                    <span className="item-label" title={item.label}>
                      {item.label}
                    </span>
                    <span className="item-amount">{zar.format(item.amount)}</span>
                  </div>
                  <button
                    className="icon-button remove-item"
                    onClick={() => removeItem(item.id)}
                    title="Remove"
                  >
                    ×
                  </button>
                </li>
              ))
            )}
          </ul>

          <div className="calculator-footer">
            <div className="calculator-total">
              <span>Total</span>
              <strong>{zar.format(totalSum)}</strong>
            </div>
            <button className="button secondary compact" onClick={clear}>
              Clear all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
