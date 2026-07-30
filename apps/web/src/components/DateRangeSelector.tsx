import {
  DATE_RANGE_OPTIONS,
  type DateRangePreset
} from "../date-range";

interface DateRangeSelectorProps {
  value: DateRangePreset;
  onChange: (value: DateRangePreset) => void;
  className?: string;
}

export function DateRangeSelector({
  value,
  onChange,
  className = ""
}: DateRangeSelectorProps) {
  return (
    <label className={`catalog-select date-range-select ${className}`.trim()}>
      <span>Date range</span>
      <select
        aria-label="Date range"
        value={value}
        onChange={(event) => onChange(event.target.value as DateRangePreset)}
      >
        {DATE_RANGE_OPTIONS.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
