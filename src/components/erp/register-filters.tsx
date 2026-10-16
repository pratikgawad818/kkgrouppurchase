import { Children, useId, useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Preserve every existing filter, but progressively disclose them on phones. */
export function RegisterFilters({
  children,
  activeCount = 0,
}: {
  children: ReactNode;
  activeCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const [search, ...filters] = Children.toArray(children);
  return (
    <div className="register-filter-bar">
      <div className="register-filter-search">{search}</div>
      <Button
        variant="outline"
        type="button"
        className="register-filter-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal aria-hidden />
        Filters {activeCount > 0 && <span className="register-filter-count">{activeCount}</span>}
      </Button>
      <div className="register-filter-fields" id={id} data-open={open}>
        {filters}
      </div>
    </div>
  );
}
