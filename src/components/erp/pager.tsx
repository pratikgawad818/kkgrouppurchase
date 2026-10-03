import { Button } from "@/components/ui/button";

export function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return <div className="mt-2 text-xs text-muted-foreground">{total} record{total === 1 ? "" : "s"}</div>;
  return (
    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
      <span>{page * size + 1}–{Math.min(total, (page + 1) * size)} of {total}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button size="sm" variant="outline" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}
