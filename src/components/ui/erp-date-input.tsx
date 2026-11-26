import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { calendarDays, calendarDateAllowed, calendarMonthAllowed, initialCalendarMonth, monthOffset } from "@/lib/date-calendar";
import { displayDateToIso, formatDateEntryInput, isoDateToDisplay, formatErpDate } from "@/lib/date-format";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** DD/MM/YYYY display, ISO API values, and an in-app calendar that does not
 * rely on browser-native date picker support or cross-origin permissions. */
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
  const [calendarOpen, setCalendarOpen] = React.useState(false);
  const today = displayDateToIso(formatErpDate(new Date().toISOString()))!;
  const lower = min ? String(min) : undefined;
  const upper = max ? String(max) : undefined;
  const [month, setMonth] = React.useState(() => initialCalendarMonth(displayDateToIso(isoDateToDisplay(incoming)), today, lower, upper));
  React.useEffect(() => { if (disabled || readOnly) setCalendarOpen(false); }, [disabled, readOnly]);
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

  function onPicked(iso: string) {
    if (disabled || readOnly || !calendarDateAllowed(iso, lower, upper)) return;
    setDisplay(isoDateToDisplay(iso));
    setTouched(false);
    forwardIso(iso);
    setCalendarOpen(false);
  }

  function onCalendarOpen(open: boolean) {
    if (open && (disabled || readOnly)) return;
    if (open) setMonth(initialCalendarMonth(parsed, today, lower, upper));
    setCalendarOpen(open);
  }

  const previous = monthOffset(month, -1);
  const next = monthOffset(month, 1);
  const canPrevious = previous.year !== month.year || previous.month !== month.month;
  const canNext = next.year !== month.year || next.month !== month.month;

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
      <Popover open={calendarOpen} onOpenChange={onCalendarOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled || readOnly}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Open date picker"
          >
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="z-[110] w-[min(20rem,calc(100vw-1.5rem))] p-3" aria-label="Choose date">
          <div className="mb-2 flex items-center justify-between gap-1">
            <button type="button" aria-label="Previous month" disabled={!canPrevious || !calendarMonthAllowed(previous, lower, upper)}
              className="grid h-9 w-9 place-items-center rounded hover:bg-muted disabled:opacity-30" onClick={() => setMonth(previous)}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold" aria-live="polite">{MONTHS[month.month - 1]} {month.year}</span>
            <button type="button" aria-label="Next month" disabled={!canNext || !calendarMonthAllowed(next, lower, upper)}
              className="grid h-9 w-9 place-items-center rounded hover:bg-muted disabled:opacity-30" onClick={() => setMonth(next)}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-sm">
            {WEEKDAYS.map(day => <span key={day} className="py-1 text-xs text-muted-foreground">{day}</span>)}
            {calendarDays(month).map((iso, index) => iso ? (
              <button key={iso} type="button" aria-label={isoDateToDisplay(iso)} aria-pressed={iso === parsed}
                aria-current={iso === today ? "date" : undefined}
                disabled={!calendarDateAllowed(iso, lower, upper)}
                className={cn("aspect-square min-h-9 rounded-md tabular-nums hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30 disabled:cursor-not-allowed",
                  iso === parsed && "bg-primary text-primary-foreground hover:bg-primary/90",
                  iso === today && iso !== parsed && "ring-1 ring-primary")}
                onClick={() => onPicked(iso)}>{Number(iso.slice(8))}</button>
            ) : <span key={"blank-" + index} />)}
          </div>
          <div className="mt-2 flex justify-end border-t pt-2">
            <button type="button" className="min-h-9 rounded px-3 text-sm font-medium text-primary disabled:opacity-40"
              disabled={!calendarDateAllowed(today, lower, upper)} onClick={() => onPicked(today)}>Today</button>
          </div>
        </PopoverContent>
      </Popover>
      {touched && invalid && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          Enter a valid date as DD/MM/YYYY{min || max ? " within the allowed range" : ""}.
        </p>
      )}
    </div>
  );
});
ErpDateInput.displayName = "ErpDateInput";
