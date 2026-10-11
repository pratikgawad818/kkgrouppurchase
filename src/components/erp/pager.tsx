import { Button } from "@/components/ui/button";
import { pagerWindow } from "@/lib/pager-window";

export function Pager({ page, total, size, onPage }: {
  page: number; total: number; size: number; onPage: (p: number) => void;
}) {
  const window = pagerWindow(total, size, page);
  if (total <= size) return <div className="mt-3 text-xs text-muted-foreground" aria-live="polite">
    {total} record{total === 1 ? "" : "s"}
  </div>;
  return (
    <nav aria-label="Pagination" className="mt-3 flex flex-col items-stretch gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span className="num text-center sm:text-left" role="status" aria-live="polite">
        {window.first}–{window.last} of {total}
      </span>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button type="button" size="sm" variant="outline" aria-label="Previous page"
          disabled={!window.hasPrevious} onClick={() => onPage(window.page - 1)}>
          Previous
        </Button>
        <Button type="button" size="sm" variant="outline" aria-label="Next page"
          disabled={!window.hasNext} onClick={() => onPage(window.page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}
