import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { MapChart, type MapSeriesOption } from 'echarts/charts';
import {
  TooltipComponent,
  VisualMapComponent,
  GeoComponent,
  TitleComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([MapChart, TooltipComponent, VisualMapComponent, GeoComponent, TitleComponent, CanvasRenderer]);

// 后端返回的省份是去掉后缀的短名（"广东"/"重庆"/"北京"...）；
// china.json 用全称（"广东省"/"重庆市"/"北京市"/"新疆维吾尔自治区"...），需要做映射。
const FULL_NAME: Record<string, string> = {
  北京: '北京市',
  天津: '天津市',
  上海: '上海市',
  重庆: '重庆市',
  河北: '河北省', 山西: '山西省', 辽宁: '辽宁省', 吉林: '吉林省', 黑龙江: '黑龙江省',
  江苏: '江苏省', 浙江: '浙江省', 安徽: '安徽省', 福建: '福建省', 江西: '江西省',
  山东: '山东省', 河南: '河南省', 湖北: '湖北省', 湖南: '湖南省', 广东: '广东省',
  海南: '海南省', 四川: '四川省', 贵州: '贵州省', 云南: '云南省', 陕西: '陕西省',
  甘肃: '甘肃省', 青海: '青海省', 台湾: '台湾省',
  内蒙古: '内蒙古自治区', 广西: '广西壮族自治区', 西藏: '西藏自治区',
  宁夏: '宁夏回族自治区', 新疆: '新疆维吾尔自治区',
  香港: '香港特别行政区', 澳门: '澳门特别行政区',
};

let registered = false;
async function ensureChinaRegistered() {
  if (registered) return;
  const res = await fetch('/china.json');
  const geo = await res.json();
  echarts.registerMap('china', geo);
  registered = true;
}

export interface ProvinceCount {
  province: string;
  count: number;
}

// 把 max 向上取整到 6 的整数倍，让每档跨度是整数
function niceCeil(n: number): number {
  if (n <= 6) return 6;
  if (n <= 12) return 12;
  if (n <= 30) return 30;
  if (n <= 60) return 60;
  if (n <= 120) return 120;
  if (n <= 300) return 300;
  if (n <= 600) return 600;
  // 大于 600 时取最近的 1000 倍数对 6 友好的值
  const mag = Math.pow(10, Math.floor(Math.log10(n)));
  const r = Math.ceil(n / mag) * mag;
  return Math.ceil(r / 6) * 6;
}

export default function ChinaMap({ data, height = 460 }: { data: ProvinceCount[]; height?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      await ensureChinaRegistered();
      if (disposed || !ref.current) return;
      if (!chartRef.current) {
        chartRef.current = echarts.init(ref.current);
      }
      const mapped = data.map((d) => ({ name: FULL_NAME[d.province] || d.province, value: d.count }));

      // 动态分档：按当前数据的 max 划成 6 档（高 → 低）；没有数据时也展示一个范围 0
      const max = Math.max(...data.map((d) => d.count), 0);
      const ceil = max <= 0 ? 6 : niceCeil(max);
      const step = ceil / 6;
      const palette = ['#1e40af', '#3b82f6', '#60a5fa', '#7dd3fc', '#bae6fd', '#e0f2fe'];
      const pieces: any[] = [];
      for (let i = 0; i < 6; i++) {
        const hi = Math.round(ceil - i * step);
        const lo = Math.round(ceil - (i + 1) * step);
        if (i === 0) {
          pieces.push({ gte: lo, lte: hi, label: `${lo} - ${hi}`, color: palette[i] });
        } else {
          pieces.push({ gte: lo, lt: hi, label: `${lo} - ${hi}`, color: palette[i] });
        }
      }

      const option: echarts.ComposeOption<MapSeriesOption> = {
        tooltip: {
          trigger: 'item',
          formatter: (p: any) => `${p.name}<br/>访问量: ${p.value ?? 0}`,
        },
        visualMap: {
          type: 'piecewise',
          left: 12,
          bottom: 24,
          itemWidth: 14,
          itemHeight: 14,
          textStyle: { color: '#6b7280', fontSize: 12 },
          pieces,
        } as any,
        series: [
          {
            type: 'map',
            map: 'china',
            roam: false,
            aspectScale: 0.78,
            layoutCenter: ['50%', '50%'],
            layoutSize: '95%',
            label: { show: true, fontSize: 10, color: '#6b7280' },
            itemStyle: { areaColor: '#f1f5f9', borderColor: '#cbd5e1' },
            emphasis: {
              label: { color: '#1d2c5b', fontWeight: 'bold' as any },
              itemStyle: { areaColor: '#bae6fd' },
            },
            data: mapped,
          },
        ],
      };
      chartRef.current.setOption(option, true);
    })();
    return () => {
      disposed = true;
    };
  }, [data]);

  useEffect(() => {
    const onResize = () => chartRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return <div ref={ref} style={{ width: '100%', height }} />;
}
