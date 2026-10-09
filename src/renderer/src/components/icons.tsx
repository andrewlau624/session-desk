// 16px line icons drawn to match the Claude desktop sidebar (1.5px stroke, round caps).

function Icon({ children, size = 16 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

export const PlusIcon = () => (
  <Icon>
    <path d="M8 3.5v9M3.5 8h9" />
  </Icon>
)

export const BoardIcon = () => (
  <Icon>
    <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
    <path d="M6.2 3v10M9.8 3v10" />
  </Icon>
)

export const SearchIcon = () => (
  <Icon>
    <circle cx="7" cy="7" r="4" />
    <path d="M10 10l3 3" />
  </Icon>
)

export const ChevronIcon = () => (
  <Icon size={14}>
    <path d="M5 6.5l3 3 3-3" />
  </Icon>
)

export const LinkIcon = () => (
  <Icon>
    <path d="M6.5 9.5l3-3M7 4.8l1-1a2.6 2.6 0 0 1 3.7 3.7l-1 1M9 11.2l-1 1a2.6 2.6 0 0 1-3.7-3.7l1-1" />
  </Icon>
)

export const RefreshIcon = () => (
  <Icon>
    <path d="M12.5 7.5A4.5 4.5 0 1 1 11 4.2M12.5 3v2.6H9.9" />
  </Icon>
)

export const MoreIcon = () => (
  <Icon>
    <circle cx="4" cy="8" r="0.6" fill="currentColor" />
    <circle cx="8" cy="8" r="0.6" fill="currentColor" />
    <circle cx="12" cy="8" r="0.6" fill="currentColor" />
  </Icon>
)

export const FolderPlusIcon = () => (
  <Icon>
    <path d="M2.5 5V4a1 1 0 0 1 1-1h2.6l1.4 1.5h5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V5z" />
    <path d="M8 7.2v3.6M6.2 9h3.6" />
  </Icon>
)

export const BranchIcon = () => (
  <Icon>
    <circle cx="5" cy="3.8" r="1.4" />
    <circle cx="5" cy="12.2" r="1.4" />
    <circle cx="11" cy="5.8" r="1.4" />
    <path d="M5 5.2v5.6M11 7.2c0 2.2-2.2 2.6-6 3.6" />
  </Icon>
)

export const FolderIcon = () => (
  <Icon size={14}>
    <path d="M2.5 4.5a1 1 0 0 1 1-1h2.6l1.4 1.5h5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
  </Icon>
)

export const NoteIcon = () => (
  <Icon size={14}>
    <path d="M4 2.5h5.5L12 5v8.5H4z" />
    <path d="M9.5 2.5V5H12M6 8h4M6 10.5h4" />
  </Icon>
)

export const ArtifactIcon = () => (
  <Icon>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
    <path d="M5.5 6.5h5M5.5 9h5M5.5 11.5h3" />
  </Icon>
)
