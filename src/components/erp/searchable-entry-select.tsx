import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { matchesRecordSearch } from "@/lib/erp-search";
import { cn } from "@/lib/utils";
import { selectCls } from "@/lib/po";

export type EntryOption = { value: string; label: string; search?: string };
/** Native select remains keyboard accessible; search never silently changes
 * the selected ID, including an already-selected item outside the results. */
export function SearchableEntrySelect({
  label, value, onChange, options, placeholder = "Select", disabled = false,
}: {
  label: string; value: string; onChange: (value: string) => void;
  options: readonly EntryOption[]; placeholder?: string; disabled?: boolean;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const matching = options.filter(option => matchesRecordSearch([option.label, option.search], search));
  const selected = options.find(option => option.value === value);
  const visible = selected && !matching.some(option => option.value === value)
    ? [selected, ...matching] : matching;
  return <div className="min-w-0 space-y-1.5">
    {!disabled && options.length > 5 && <>
      <label className="sr-only" htmlFor={id + "-search"}>Search {label}</label>
      <Input id={id + "-search"} type="search" value={search} onChange={event => setSearch(event.target.value)}
        placeholder={"Find " + label.toLowerCase() + "…"} autoComplete="off" />
      {search.trim() && <p className="text-xs text-muted-foreground" aria-live="polite">
        {matching.length} matching {matching.length === 1 ? "option" : "options"}
        {selected && !matching.some(option => option.value === value) ? " · current selection retained" : ""}
      </p>}
    </>}
    <select aria-label={label} className={cn(selectCls,"w-full")} value={value} disabled={disabled}
      onChange={event => { onChange(event.target.value); setSearch(""); }}>
      <option value="">{placeholder}</option>
      {value && !selected && <option value={value} disabled>Current selection unavailable</option>}
      {visible.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </div>;
}
