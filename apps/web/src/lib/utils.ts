import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Shorten model names for display. */
export function shortenModel(model: string | undefined): string {
  if (!model) return 'default';
  if (model.includes('haiku')) return 'Haiku';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('opus')) return 'Opus';
  if (model.includes('llama')) return model.split('/').pop() || 'Llama';
  if (model.includes('groq')) return model.split('/').pop() || model;
  if (model.includes('/')) return model.split('/').pop() || model;
  return model;
}
