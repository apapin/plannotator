import React from 'react';
import {
  ActionMenu,
  ActionMenuDivider,
  ActionMenuItem,
  ActionMenuSectionLabel,
} from './ActionMenu';
import { useTheme } from './ThemeProvider';

interface MobileMenuProps {
  isPanelOpen: boolean;
  onTogglePanel: () => void;
  annotationCount: number;
  onOpenExport: () => void;
  onOpenSettings: () => void;
  onDownloadAnnotations: () => void;
  onCopyShareLink: () => void;
  onOpenImport: () => void;
  onPrint: () => void;
  shareUrl?: string;
  sharingEnabled: boolean;
  className?: string;
}

export const MobileMenu: React.FC<MobileMenuProps> = ({
  isPanelOpen,
  onTogglePanel,
  annotationCount,
  onOpenExport,
  onOpenSettings,
  onDownloadAnnotations,
  onCopyShareLink,
  onOpenImport,
  onPrint,
  sharingEnabled,
  className,
}) => {
  const { theme, setTheme } = useTheme();

  return (
    <ActionMenu
      className={className}
      renderTrigger={({ isOpen, toggleMenu }) => (
        <button
          onClick={toggleMenu}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Menu"
        >
          {isOpen ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      )}
      panelClassName="absolute top-full right-0 mt-1 w-56 bg-popover border border-border rounded-lg shadow-xl z-[70] py-1"
    >
      {({ closeMenu }) => (
        <>
          <div className="px-3 py-2">
            <div className="mb-1.5">
              <ActionMenuSectionLabel>Theme</ActionMenuSectionLabel>
            </div>
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`flex-1 px-2 py-1 text-[10px] capitalize rounded-md transition-colors ${
                    theme === t
                      ? 'bg-background text-foreground shadow-sm font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <ActionMenuDivider />

          <ActionMenuItem
            onClick={() => {
              closeMenu();
              onOpenSettings();
            }}
            icon={<SettingsIcon />}
            label="Settings"
          />

          <ActionMenuItem
            onClick={() => {
              closeMenu();
              onTogglePanel();
            }}
            icon={<AnnotationsIcon />}
            label={isPanelOpen ? 'Hide Annotations' : 'Show Annotations'}
            badge={annotationCount > 0 ? (
              <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                {annotationCount}
              </span>
            ) : undefined}
          />

          <ActionMenuDivider />

          <ActionMenuItem
            onClick={() => {
              closeMenu();
              onOpenExport();
            }}
            icon={<ExportIcon />}
            label="Export"
          />

          <ActionMenuItem
            onClick={() => {
              closeMenu();
              onDownloadAnnotations();
            }}
            icon={<DownloadIcon />}
            label="Download Annotations"
          />

          <ActionMenuItem
            onClick={() => {
              closeMenu();
              onPrint();
            }}
            icon={<PrintIcon />}
            label="Print Plan"
          />

          {sharingEnabled && (
            <ActionMenuItem
              onClick={() => {
                closeMenu();
                onCopyShareLink();
              }}
              icon={<LinkIcon />}
              label="Copy Share Link"
            />
          )}

          {sharingEnabled && (
            <>
              <ActionMenuDivider />
              <ActionMenuItem
                onClick={() => {
                  closeMenu();
                  onOpenImport();
                }}
                icon={<ImportIcon />}
                label="Import Review"
              />
            </>
          )}
        </>
      )}
    </ActionMenu>
  );
};

// Icons
const SettingsIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const AnnotationsIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
  </svg>
);

const ExportIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
);

const DownloadIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
  </svg>
);

const LinkIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
  </svg>
);

const ImportIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />
  </svg>
);

const PrintIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
  </svg>
);
