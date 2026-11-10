// Inline SVG icons. These are constant strings written in this file —
// never user or network data — so parsing them as markup is safe.

const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  play: '<path d="M8 5.6v12.8a1 1 0 0 0 1.53.85l10-6.4a1 1 0 0 0 0-1.7l-10-6.4A1 1 0 0 0 8 5.6z"/>',
  pause: '<rect x="6" y="5" width="4.5" height="14" rx="1.3"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.3"/>',
  next: '<path d="M5 6.3v11.4a.9.9 0 0 0 1.4.75L15 12.9v4.6a1 1 0 0 0 2 0v-11a1 1 0 0 0-2 0v4.6L6.4 5.55A.9.9 0 0 0 5 6.3z"/>',
  prev: '<path d="M19 6.3v11.4a.9.9 0 0 1-1.4.75L9 12.9v4.6a1 1 0 0 1-2 0v-11a1 1 0 0 1 2 0v4.6l8.6-5.55A.9.9 0 0 1 19 6.3z"/>',
  shuffle: `<path ${S} d="M3 7h3c2.2 0 3.4 1.1 4.6 2.9l2.8 4.2C14.6 15.9 15.8 17 18 17h3M18 14l3 3-3 3M3 17h3c1.5 0 2.5-.5 3.3-1.3M14.7 8.3C15.5 7.5 16.5 7 18 7h3M18 4l3 3-3 3"/>`,
  repeat: `<path ${S} d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20M17 3l3 3-3 3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4M7 21l-3-3 3-3"/>`,
  repeatOne: `<path ${S} d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20M17 3l3 3-3 3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4M7 21l-3-3 3-3"/><path ${S} d="M11 11l1.5-1v4.5"/>`,
  heart: '<path d="M12 20.3s-7.4-4.5-9.2-9.1C1.6 8.1 3.5 4.8 6.9 4.6c2-.1 3.5 1 4.1 2.5.6-1.5 2.1-2.6 4.1-2.5 3.4.2 5.3 3.5 4.1 6.6-1.8 4.6-9.2 9.1-9.2 9.1z"/>',
  more: '<circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/>',
  volume: `<path d="M4 9.6v4.8a1 1 0 0 0 1 1h3l4.3 3.5a.8.8 0 0 0 1.3-.62V5.72a.8.8 0 0 0-1.3-.62L8 8.6H5a1 1 0 0 0-1 1z"/><path ${S} d="M16.5 8.8a4.6 4.6 0 0 1 0 6.4M19 6.3a8.2 8.2 0 0 1 0 11.4"/>`,
  mute: `<path d="M4 9.6v4.8a1 1 0 0 0 1 1h3l4.3 3.5a.8.8 0 0 0 1.3-.62V5.72a.8.8 0 0 0-1.3-.62L8 8.6H5a1 1 0 0 0-1 1z"/><path ${S} d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>`,
  queue: `<path ${S} d="M4 6h12M4 11h12M4 16h7"/><path d="M15 13.5v6l5-3z"/>`,
  gear: `<circle ${S} cx="12" cy="12" r="3.3"/><path ${S} d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8"/>`,
  search: `<circle ${S} cx="10.5" cy="10.5" r="6"/><path ${S} d="M15 15l5 5"/>`,
  close: `<path ${S} d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`,
  back: `<path ${S} d="M15 5l-7 7 7 7"/>`,
  up: `<path ${S} d="M6 15l6-6 6 6"/>`,
  down: `<path ${S} d="M6 9l6 6 6-6"/>`,
  sort: `<path ${S} d="M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3"/>`,
  filter: `<path ${S} d="M4 6h16M7 12h10M10 18h4"/>`,
  chevron: `<path ${S} d="M7 10l5 5 5-5"/>`,
  user: `<circle ${S} cx="12" cy="8.5" r="3.5"/><path ${S} d="M5 20c.8-3.4 3.6-5.5 7-5.5s6.2 2.1 7 5.5"/>`,
  mini: `<rect ${S} x="3" y="5" width="18" height="14" rx="2.5"/><rect x="11.5" y="11.5" width="7.5" height="5.5" rx="1.2"/>`,
  expand: `<path ${S} d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>`,
  pin: `<path ${S} d="M9 4h6l-1 6 3 3v1.5H7V13l3-3-1-6zM12 14.5V20"/>`,
  winMin: `<path ${S} d="M6 12.5h12"/>`,
  winMax: `<rect ${S} x="6" y="6" width="12" height="12" rx="1.5"/>`,
  winClose: `<path ${S} d="M7 7l10 10M17 7 7 17"/>`,
  sliders: `<path ${S} d="M6 4v5M6 14v6M12 4v9M12 18v2M18 4v3M18 12v8"/><circle ${S} cx="6" cy="11.5" r="2.2"/><circle ${S} cx="12" cy="15.5" r="2.2"/><circle ${S} cx="18" cy="9.5" r="2.2"/>`,
  wave: `<path ${S} d="M3 12h2l2-5 3 11 3-14 3 12 2-4h3"/>`,
  locate: `<circle ${S} cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2.2"/><path ${S} d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>`,
  plus: `<path ${S} d="M12 5v14M5 12h14"/>`,
  grip: '<circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/>',
  edit: `<path ${S} d="M5 19h4L19 9l-4-4L5 15v4zM13 7l4 4"/>`,
  trash: `<path ${S} d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>`,
  download: `<path ${S} d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/>`,
} as const;

export type IconName = keyof typeof PATHS;

const templates = new Map<IconName, SVGElement>();

export function icon(name: IconName): SVGElement {
  let tpl = templates.get(name);
  if (!tpl) {
    const t = document.createElement("template");
    t.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
    tpl = t.content.firstElementChild as SVGElement;
    templates.set(name, tpl);
  }
  return tpl.cloneNode(true) as SVGElement;
}
