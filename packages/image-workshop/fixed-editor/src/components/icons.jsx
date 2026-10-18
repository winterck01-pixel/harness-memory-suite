// 统一 SVG 轮廓图标（契约/IMPLEMENTATION：不用不明确的 Unicode 符号充当正式图标）
import React from 'react';

function Icon({ size = 20, children, title }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined} aria-label={title} focusable="false">
      {children}
    </svg>
  );
}

export const SelectIcon = (p) => (
  <Icon {...p}><path d="M5 3l14 8-6 1.5L10 19 5 3z" /></Icon>
);
export const HandIcon = (p) => (
  <Icon {...p}><path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0 0V4.5a1.5 1.5 0 0 1 3 0V11m0 0V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6v-2.5a1.5 1.5 0 0 1 3 0V13" /></Icon>
);
export const UploadIcon = (p) => (
  <Icon {...p}><path d="M12 16V4m-4 4 4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></Icon>
);
export const FitIcon = (p) => (
  <Icon {...p}><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" /></Icon>
);
export const EyeIcon = (p) => (
  <Icon {...p}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.6" /></Icon>
);
export const EyeOffIcon = (p) => (
  <Icon {...p}><path d="M4 4l16 16M10 5.2A9.9 9.9 0 0 1 12 5c6.5 0 10 6 10 6a17 17 0 0 1-3 3.6M6.5 7.6A16.6 16.6 0 0 0 2 12s3.5 6 10 6c1 0 1.9-.1 2.7-.4" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Icon>
);
export const LockIcon = (p) => (
  <Icon {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Icon>
);
export const UnlockIcon = (p) => (
  <Icon {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></Icon>
);
export const TrashIcon = (p) => (
  <Icon {...p}><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></Icon>
);
export const PlusIcon = (p) => (
  <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>
);
export const CloseIcon = (p) => (
  <Icon {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>
);
export const UpIcon = (p) => (
  <Icon {...p}><path d="M12 5v14m-4-4 4 4 4-4" /></Icon>
);
export const DownIcon = (p) => (
  <Icon {...p}><path d="M12 19V5m-4 4 4-4 4 4" /></Icon>
);
export const DownloadIcon = (p) => (
  <Icon {...p}><path d="M12 3v12m-4-4 4 4 4-4M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></Icon>
);
export const ExportIcon = (p) => (
  <Icon {...p}><path d="M12 15V3m-4 4 4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></Icon>
);
export const ReferenceIcon = (p) => (
  <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 15l4-4 3 3 4-5 7 7" /><circle cx="8.5" cy="9" r="1.4" /></Icon>
);
export const TargetIcon = (p) => (
  <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 3" /><path d="M12 8v8M8 12h8" /></Icon>
);
export const UndoIcon = (p) => (
  <Icon {...p}><path d="M9 7L4 12l5 5" /><path d="M4 12h11a5 5 0 0 1 5 5v0" /></Icon>
);
export const RedoIcon = (p) => (
  <Icon {...p}><path d="M15 7l5 5-5 5" /><path d="M20 12H9a5 5 0 0 0-5 5v0" /></Icon>
);
export const ProjectIcon = (p) => (
  <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></Icon>
);
export const LayerIcon = (p) => (
  <Icon {...p}><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></Icon>
);
export const CardIcon = (p) => (
  <Icon {...p}><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M8 6V4h8v2M7 11h6" /></Icon>
);
