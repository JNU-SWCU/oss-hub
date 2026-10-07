import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: [
        'card',
        'control',
        'row',
        'sidebar-collapsed',
        'sidebar-open',
        'tag',
        'tile',
        'topbar',
      ],
      radius: ['card', 'control'],
    },
    classGroups: {
      'font-size': [
        'text-page',
        'text-section',
        'text-body',
        'text-small',
        'text-badge',
        'text-table',
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
