'use client';
import { toast as sonnerToast } from 'sonner';

// Same signature the doc's pages use: toast(message, kind).
export function toast(message, kind = 'info') {
  if (kind === 'error') sonnerToast.error(message);
  else if (kind === 'success') sonnerToast.success(message);
  else sonnerToast(message);
}
