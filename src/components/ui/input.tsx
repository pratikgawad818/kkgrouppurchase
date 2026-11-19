import * as React from "react";

import { cn } from "@/lib/utils";
import { ErpDateInput } from "@/components/ui/erp-date-input";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    const fieldClass = cn(
      "flex h-11 w-full rounded-lg sm:h-9 border border-input shadow-sm bg-transparent px-3 py-1 text-base transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
      className,
    );
    if (type === "date") {
      return <ErpDateInput {...props} className={fieldClass} ref={ref} />;
    }
    return (
      <input
        type={type}
        className={fieldClass}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
