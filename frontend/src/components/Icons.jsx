/* Íconos de línea (SVG en línea, sin dependencias). 20px, heredan el color. */

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export const IconDashboard = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="3" width="8" height="5" rx="1.5" />
    <rect x="13" y="11" width="8" height="10" rx="1.5" />
    <rect x="3" y="14" width="8" height="7" rx="1.5" />
  </svg>
);

export const IconLogo = (p) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="4" width="19" height="12" rx="2" />
    <path d="M8.5 20h7M12 16v4" />
    <path
      d="M15.2 7.3c1.7-.2 2.9.7 2.8 2.3-.1 1.5-1.5 2.2-3 2-.1-1.5 0-3 .2-4.3z"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);

export const IconScreen = (p) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="4" width="19" height="12" rx="2" />
    <path d="M8.5 20h7M12 16v4" />
  </svg>
);

export const IconLink = (p) => (
  <svg {...base} {...p}>
    <path d="M9 12h6" />
    <path d="M10.5 8H8a4 4 0 0 0 0 8h2.5" />
    <path d="M13.5 8H16a4 4 0 0 1 0 8h-2.5" />
  </svg>
);

export const IconGroups = (p) => (
  <svg {...base} {...p}>
    <circle cx="8" cy="9" r="3" />
    <path d="M2.5 19a5.5 5.5 0 0 1 11 0" />
    <path d="M16 6.5a3 3 0 0 1 0 5.8M21.5 19a5.5 5.5 0 0 0-4-5.3" />
  </svg>
);

export const IconPlaylist = (p) => (
  <svg {...base} {...p}>
    <path d="M4 6h11M4 12h11M4 18h7" />
    <path d="M18 12.5v5.2" />
    <circle cx="16.5" cy="18" r="1.6" />
  </svg>
);

export const IconAssets = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="M21 16l-5-5-9 9" />
  </svg>
);

export const IconReports = (p) => (
  <svg {...base} {...p}>
    <path d="M4 20V4" />
    <path d="M4 20h16" />
    <rect x="7.5" y="11" width="3" height="6" rx="0.6" />
    <rect x="13.5" y="7" width="3" height="10" rx="0.6" />
  </svg>
);

export const IconLogout = (p) => (
  <svg {...base} {...p}>
    <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
    <path d="M10 12H3M6 8l-4 4 4 4" />
  </svg>
);

export const IconTotal = (p) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="4" width="19" height="12" rx="2" />
    <path d="M8.5 20h7M12 16v4" />
  </svg>
);

export const IconOnline = (p) => (
  <svg {...base} {...p}>
    <path d="M5 12.5a9 9 0 0 1 14 0" />
    <path d="M8 15.5a5 5 0 0 1 8 0" />
    <circle cx="12" cy="19" r="1" fill="currentColor" />
  </svg>
);

export const IconOffline = (p) => (
  <svg {...base} {...p}>
    <path d="M3 3l18 18" />
    <path d="M8 15.5a5 5 0 0 1 6.5-.7M5 12.5a9 9 0 0 1 3-2" />
    <path d="M16 10a9 9 0 0 1 3 2.5" />
    <circle cx="12" cy="19" r="1" fill="currentColor" />
  </svg>
);

export const IconPending = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v4l2.5 1.5" />
  </svg>
);

export const IconDisabled = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M6.5 6.5l11 11" />
  </svg>
);

export const IconRefresh = (p) => (
  <svg {...base} {...p}>
    <path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <path d="M20 4v4h-4" />
  </svg>
);

export const IconChevron = (p) => (
  <svg {...base} {...p}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const IconMagic = (p) => (
  <svg {...base} {...p}>
    <path d="M5 3v4M3 5h4M18 13v4M16 15h4" />
    <path d="M12 3l1.8 4.6L18 9.5l-4.2 1.9L12 16l-1.8-4.6L6 9.5l4.2-1.9z" />
  </svg>
);
