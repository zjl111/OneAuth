import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { MapChart } from 'echarts/charts';
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

// 用版本号让过滤逻辑变更后强制重新注册地图（避免 HMR / 浏览器缓存命中旧 china map）
const MAP_VERSION = 'china_v3_trim_south_sea';
let registeredVersion = '';

// 把任意嵌套坐标数组拍平成 [lon, lat][]
function collectPoints(coords: any, out: number[][] = []): number[][] {
  if (Array.isArray(coords)) {
    if (coords.length === 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      out.push(coords as number[]);
    } else {
      for (const c of coords) collectPoints(c, out);
    }
  }
  return out;
}

// MultiPolygon 里剔除所有 lat 平均值 < 18（即南海远岛）的子多边形，只保留海南本岛主体
function trimSouthSeaIslands(feature: any): any {
  const g = feature?.geometry;
  if (!g) return feature;
  const filterPoly = (poly: any) => {
    const pts = collectPoints(poly);
    if (pts.length === 0) return false;
    const avgLat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return avgLat >= 18;
  };
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    g.coordinates = g.coordinates.filter(filterPoly);
  }
  return feature;
}

async function ensureChinaRegistered() {
  if (registeredVersion === MAP_VERSION) return;
  const res = await fetch('/china.json');
  const geo = await res.json();
  if (Array.isArray(geo?.features)) {
    geo.features = geo.features
      // 1) 移除"南海诸岛"虚线框（properties.name 为空 / "南海诸岛"）
      .filter((f: any) => {
        const n = f?.properties?.name;
        return n && n !== '南海诸岛';
      })
      // 2) 海南省里剔除南海远岛多边形，避免地图下方那串虚线轮廓
      .map((f: any) => (f?.properties?.name === '海南省' ? trimSouthSeaIslands(f) : f));
  }
  echarts.registerMap('china', geo);
  registeredVersion = MAP_VERSION;
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
      const mapped = data.map((d) => ({ name: FULL_NAME[d.province] || d.province, value: d.count }));

      // 固定分档，颜色从深到浅
      const pieces = [
        { gt: 2000,             label: '2000 以上',     color: '#1e40af' },
        { gte: 1001, lte: 2000, label: '1001 - 2000',  color: '#3b82f6' },
        { gte: 501,  lte: 1000, label: '501 - 1000',   color: '#60a5fa' },
        { gte: 301,  lte: 500,  label: '301 - 500',    color: '#7dd3fc' },
        { gte: 101,  lte: 300,  label: '101 - 300',    color: '#bae6fd' },
        { gte: 1,    lte: 100,  label: '1 - 100',      color: '#e0f2fe' },
      ];

      const option: any = {
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
            layoutSize: '134%',
            label: { show: true, fontSize: 11, color: '#6b7280' },
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
