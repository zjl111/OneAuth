export type AppStatusKind = 'up' | 'degraded' | 'down' | 'maintenance' | 'no_data';

export const STATUS = {
  up: 'up',
  degraded: 'degraded',
  down: 'down',
  maintenance: 'maintenance',
  noData: 'no_data',
} as const;
