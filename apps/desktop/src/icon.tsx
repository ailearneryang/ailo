import React from 'react';
// A single stroke weight and viewbox keep navigation icons optically consistent.
export function Icon({ name }: { name: 'sparkles' | 'plug' | 'chevron-right' | 'plus' | 'arrow-up' | 'compose' | 'chat' | 'grid' | 'folder' | 'info' | 'user' | 'chevron' | 'paperclip' | 'panel' | 'expand' | 'file' | 'queue' | 'play' | 'edit' | 'trash' | 'check' | 'close' | 'clock' }) {
  const shapes = {
    sparkles: <><path d="m10 3 2.4 6.6L19 12l-6.6 2.4L10 21l-2.4-6.6L1 12l6.6-2.4Z"/><path d="M19 2v6M16 5h6"/></>,
    plug: <><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4"/></>,
    'chevron-right': <path d="m9 6 6 6-6 6"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    'arrow-up': <path d="M12 20V4m-7 7 7-7 7 7"/>,
    queue: <><path d="M8 6h12M8 12h12M8 18h8"/><circle cx="3" cy="6" r=".7"/><circle cx="3" cy="12" r=".7"/><circle cx="3" cy="18" r=".7"/></>,
    play: <><rect x="3" y="3" width="18" height="18" rx="5"/><path d="m10 8 5 4-5 4Z"/></>,
    edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15Z"/><path d="M13 21h8"/></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    panel: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/></>,
    expand: <><path d="M14 3h7v7M21 3l-7 7M10 21H3v-7M3 21l7-7"/></>,
    file: <><path d="M14 3H5v18h14V8Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/></>,
    compose: <><path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7"/><path d="m16 3 5 5M10 14l-1 4 4-1L22 8a2 2 0 0 0-5-5Z"/></>,
    chat: <path d="M20 11.5a8 8 0 0 1-8 8H4l1.5-4A8 8 0 1 1 20 11.5Z" />,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
    chevron: <path d="m7 14 5-5 5 5"/>,
    paperclip: <path d="m20 11-8 8a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/>,
  };
  return <svg className="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[name]}</svg>;
}
