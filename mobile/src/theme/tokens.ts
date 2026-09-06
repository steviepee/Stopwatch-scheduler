export const colors = {
  background: '#1a1a2e',
  scrim: 'rgba(0, 0, 0, 0.35)',
  glass: 'rgba(255, 255, 255, 0.1)',
  glassInner: 'rgba(255, 255, 255, 0.05)',
  glassBorder: 'rgba(255, 255, 255, 0.2)',
  glassBorderInner: 'rgba(255, 255, 255, 0.1)',
  text: '#ffffff',
  textMuted: 'rgba(255, 255, 255, 0.6)',
  placeholder: 'rgba(255, 255, 255, 0.5)',
  primary: '#6366f1',
  primaryDeep: '#8b5cf6',
  green: '#22c55e',
  greenDeep: '#16a34a',
  red: '#ef4444',
  redDeep: '#dc2626',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 64,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 56, fontWeight: '700' },
  title: { fontSize: 28, fontWeight: '600' },
  heading: { fontSize: 20, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400' },
  label: { fontSize: 14, fontWeight: '500' },
  caption: { fontSize: 12, fontWeight: '400' },
} as const;

export const touchTarget = 44;
