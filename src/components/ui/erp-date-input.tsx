import * as React from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { displayDateToIso, formatDateEntryInput, isoDateToDisplay } from "@/lib/date-format";

/**
 * Display DD/MM/YYYY in every shared ERP date field while keeping the API
 * value ISO YYYY-MM-DD. iPhone Safari must receive a real touch on the
 * native date input; programmatically clicking a 1-pixel hidden picker can fail.
 * The native control covers the calendar icon on touch screens and leaves the
 * canonical DD/MM/YYYY text field editable for manual numeric entry.
 *
 * The onChange adapter provides the ISO value expected by existing forms.
 */
export const ErpDateInput = React.forwardRef<
  HTMLInputElement, React.ComponentProps<"input">
>(function ErpDateInput({
  className, value, defaultValue, onChange, onBlur, min, max,
  disabled, readOnly, required, placeholder, id, ...props
}, ref) {
  const incoming = String(value ?? defaultValue ?? "");
  const [display, setDisplay] = React.useState(() => isoDateToDisplay(incoming));
  const [touched, setTouched] = React.useState(false);
  const lastEmitted = React.useRef<string | null>(null);
  const picker = React.useRef<HTMLInputElement>(null);
  const textRef = React.useRef<HTMLInputElement | null>(null);

  React.useImperativeHandle(ref, () => textRef.current!, []);

  // External resets, record changes or edits must update what users see.
  React.useEffect(() => {
    const next = String(value ?? defaultValue ?? "");
    if (lastEmitted.current === next) {
      lastEmitted.current = null;
      return;
    }
    lastEmitted.current = null;
    setDisplay(isoDateToDisplay(next));
    setTouched(false);
  }, [value, defaultValue]);

  const parsed = displayDateToIso(display);
  const withinBounds = !!parsed && (!min || parsed >= String(min)) &&
    (!max || parsed <= String(max));
  const invalid = display.length > 0 && !withinBounds;

  React.useEffect(() => {
    textRef.current?.setCustomValidity(invalid ? "Enter DD/MM/YYYY." : "");
  }, [invalid]);

  function forwardIso(
    iso: string,
    event?: React.ChangeEvent<HTMLInputElement>,
  ) {
    lastEmitted.current = iso;
    if (!onChange) return;
    // Form handlers consistently read event.target.value. Native date inputs
    // previously returned ISO strings; preserve that interface.
    const target = event?.target ?? textRef.current;
    const wrapped = {
      ...(event ?? {}),
      target: {
        value: iso, name: props.name ?? target?.name ?? "",
        id: target?.id ?? id ?? "", checked: false,
      },
      currentTarget: {
        value: iso, name: props.name ?? target?.name ?? "",
        id: target?.id ?? id ?? "", checked: false,
      },
    } as React.ChangeEvent<HTMLInputElement>;
    onChange(wrapped);
  }

  function onTextChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = formatDateEntryInput(event.target.value);
    setDisplay(next);
    const iso = displayDateToIso(next);
    const valid = iso && (!min || iso >= String(min)) && (!max || iso <= String(max));
    // Invalid/partial edits clear the API value; never submit an earlier date.
    forwardIso(valid ? iso : "", event);
  }

  function onPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const iso = event.target.value;
    const valid = !!iso && displayDateToIso(isoDateToDisplay(iso)) === iso &&
      (!min || iso >= String(min)) && (!max || iso <= String(max));
    setDisplay(valid ? isoDateToDisplay(iso) : "");
    setTouched(false);
    forwardIso(valid ? iso : "", event);
  }

  function openPicker() {
    if (disabled || readOnly) return;
    const element = picker.current;
    if (!element) return;
    try {
      if (typeof element.showPicker === "function") element.showPicker();
      else element.click();
    } catch {
      element.focus();
      element.click();
    }
  }

  return (
    <div className="relative min-w-0">
      <input
        {...props}
        id={id}
        ref={textRef}
        type="text"
        value={display}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        placeholder={placeholder || "DD/MM/YYYY"}
        autoComplete="off"
        inputMode="numeric"
        maxLength={10}
        pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}"
        aria-label={props["aria-label"] || "Date (DD/MM/YYYY)"}
        aria-invalid={touched && invalid ? true : undefined}
        className={cn(className, "pr-11 tabular-nums")}
        onChange={onTextChange}
        onBlur={(event) => {
          setTouched(true);
          onBlur?.(event);
        }}
      />
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled || readOnly}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Open date picker"
      >
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
      </button>
      <input
        ref={picker}
        type="date"
        value={withinBounds ? parsed! : ""}
        min={min}
        max={max}
        disabled={disabled || readOnly}
        onChange={onPicked}
        tabIndex={-1}
        // On iOS Safari showPicker() and .click() on tiny hidden inputs may
        // be blocked. This *native* input receives the user's actual tap
        // across the full 44px calendar target. Fine-pointer browsers keep
        // using the visible button's showPicker() behavior.
        aria-label={`Choose date for ${props["aria-label"] ?? "Date"}`}
        className="pointer-events-none absolute inset-y-0 right-0 z-10 h-full w-11 min-w-11 cursor-pointer opacity-0 [@media(hover:none)_and_(pointer:coarse)]:pointer-events-auto"
      />
      {touched && invalid && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          Enter a valid date as DD/MM/YYYY{min || max ? " within the allowed range" : ""}.
        </p>
      )}
    </div>
  );
});
ErpDateInput.displayName = "ErpDateInput";
