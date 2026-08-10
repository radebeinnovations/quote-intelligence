import { zar } from "../format";
import { useCalculator } from "../calculator";

export function Price({
  amount,
  label = "Item"
}: {
  amount: number | null;
  label?: string;
}) {
  const { addItem } = useCalculator();

  if (amount === null || Number.isNaN(amount)) {
    return <span>—</span>;
  }

  return (
    <button
      className="clickable-price"
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        addItem(amount, label);
      }}
      title={`Add ${zar.format(amount)} to calculator`}
    >
      {zar.format(amount)}
    </button>
  );
}
