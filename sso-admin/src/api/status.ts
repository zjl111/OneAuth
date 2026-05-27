import axios from 'axios';
import type { AppStatusKind } from '@/types/status';

const statusClient = axios.create({
  baseURL: '/api/status',
  timeout: 15000,
});

export interface AppStatus {
  id: string;
  client_id: string;
  name: string;
  description: string;
  logo_url: string;
  status: AppStatusKind;
  availability_current: number;
  response_time_ms: number;
  last_probed_at: string | null;
  windows: Record<string, number>;
  avg_response: Record<string, number>;
  timeline: Array<{
    date: string;
    status: string;
    availability: number;
    avg_response_ms: number;
    max_response_ms: number;
    total_probes: number;
    success_probes: number;
  }>;
}

export interface StatusOverview {
  overall_status: 'operational' | 'degraded' | 'maintenance';
  last_updated: string;
  refresh_interval_seconds: number;
  availability_24h_percent: number;
  avg_response_ms: number;
  apps: AppStatus[];
}

export const statusApi = {
  overview: async (): Promise<StatusOverview> => {
    const r = await statusClient.get('/overview');
    return r.data.data;
  },
};
