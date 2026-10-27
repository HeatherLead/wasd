export const PRIMARY_COLOR = '#148937';
export const PRIMARY_COLOR_HOVER = '#0f6c2b';
export const PRIMARY_COLOR_ACTIVE = '#0c5622';
export const PRIMARY_COLOR_LIGHT = '#e8f5ec';
export const PRIMARY_COLOR_SUBTLE = '#f0f9f3';
export const PRIMARY_COLOR_AREA = 'rgba(20, 137, 55, 0.15)';

export const DEFAULT_CUTOFF_TIME = '09:00';
export const DEFAULT_SELECTED_DATE = '2026-01-15';
export const DEFAULT_DEMAND_MW = 12000;
export const DEMAND_PRESETS = [8000, 10000, 12000, 15000];
export const DEFAULT_COVERAGE = 0.80;
export const DEFAULT_PAGE = 'accuracy' as const;

export const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export const MONTH_RANGE_JANUARY = {
  startDate: '2026-01-01',
  endDate: '2026-01-31',
};

export const PAGE2_CSV_HEADERS = [
  'Settlement Period',
  'Start Time (UTC)',
  'Forecast (MW)',
  'Actual Low (MW)',
  'Actual High (MW)',
  'Shortfall Prob P(error > T)',
  'Horizon (hours)',
  'Basis',
  'Sample Size',
];

export const BOX_PLOT_DIMENSIONS = {
  svgWidth: 720,
  svgHeight: 140,
  margin: { left: 40, right: 40, top: 30, bottom: 40 },
  plotCenterY: 55,
  boxHeight: 44,
};
