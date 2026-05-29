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
      const max = Math.max(50, ...data.map((d) => d.count));
      const mapped = data.map((d) => ({ name: FULL_NAME[d.province] || d.province, value: d.count }));

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
          pieces: [
            { gte: 450, lte: 500, label: '450 - 500', color: '#ef4444' },
            { gte: 400, lt: 450, label: '400 - 450', color: '#3b82f6' },
            { gte: 350, lt: 400, label: '350 - 400', color: '#c4b5fd' },
            { gte: 300, lt: 350, label: '300 - 350', color: '#4f46e5' },
            { gte: 250, lt: 300, label: '250 - 300', color: '#6366f1' },
            { gte: 200, lt: 250, label: '200 - 250', color: '#10b981' },
            { gte: 150, lt: 200, label: '150 - 200', color: '#22d3ee' },
            { gte: 100, lt: 150, label: '100 - 150', color: '#f59e0b' },
            { gte: 50, lt: 100, label: '50 - 100', color: '#fde68a' },
            { gte: 0, lt: 50, label: '0 - 50', color: '#e0f2fe' },
          ],
        } as any,
        series: [
          {
            type: 'map',
            map: 'china',
            roam: false,
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
      // 隐藏暗示：用 max 是为了未来扩展，这里保持依赖以免 lint 抱怨
      void max;
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
