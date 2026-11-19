import { useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type MaterialOption = {
  id: string;
  name: string;
  code?: string | null;
};

type MaterialSearchSelectProps = {
  value: string;
  materials: readonly MaterialOption[];
  onChange: (id: string) => void;
  disabled?: boolean;
};

/**
 * A searchable, keyboard-accessible alternative to long native selects.
 * Search matches material name and code; selected ID stays unchanged, so
 * warehouse units and request lines continue using the canonical master.
 */
export function MaterialSearchSelect({
  value, materials, onChange, disabled,
}: MaterialSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = materials.find((material) => material.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label="Material"
          aria-expanded={open}
          disabled={disabled}
          className="h-11 w-full min-w-0 justify-between gap-2 px-3 text-left font-normal"
        >
          <span className="min-w-0 flex-1 truncate">
            {selected ? selected.name : "Search and select material"}
            {selected?.code && (
              <span className="ml-1 text-xs text-muted-foreground">({selected.code})</span>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"
      >
        <Command>
          <CommandInput placeholder="Type material name or code…" aria-label="Search materials" />
          <CommandList className="max-h-64">
            <CommandEmpty>No matching materials.</CommandEmpty>
            <CommandGroup>
              {materials.map((material) => (
                <CommandItem
                  key={material.id}
                  value={`${material.name} ${material.code ?? ""} ${material.id}`}
                  onSelect={() => {
                    onChange(material.id);
                    setOpen(false);
                  }}
                  className="min-h-11 cursor-pointer py-2"
                >
                  <Check className={cn(
                    "mr-2 h-4 w-4 shrink-0",
                    value === material.id ? "opacity-100" : "opacity-0",
                  )} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block whitespace-normal break-words font-medium">{material.name}</span>
                    {material.code && (
                      <span className="block text-xs text-muted-foreground">{material.code}</span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <div className="flex items-center gap-1 border-t px-3 py-2 text-xs text-muted-foreground">
            <Search className="h-3 w-3" aria-hidden="true" />
            {materials.length} material(s) available
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
