import axios from 'axios';

const client = axios.create({ baseURL: '/api/v1', timeout: 8000 });

export interface SiteInfo {
  name: string;
  logo: string;
  theme_color: string;
  hero_title?: string;
  hero_subtitle?: string;
  hero_description?: string;
  login_style?: 'modal' | 'inline';
  notice_enabled?: boolean;
  notice_text?: string;
  smtp_enabled?: boolean;
}

export const siteApi = {
  info: async (): Promise<SiteInfo> => {
    const r = await client.get('/site');
    return r.data.data;
  },
};
