import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Strip PostgREST filter syntax characters from user search text before use in .or()/ilike filters. */
export function safeSearch(input: string): string {
  return input.replace(/[,()*%\\:."']/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}
