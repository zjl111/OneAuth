import { Button, Upload, App as AntdApp } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/store/authStore';

/**
 * 通用 Logo / 图标上传组件
 * - 大的虚框预览（可点击上传）+ 下方 "上传 XX" 按钮（也可点）
 * - 与应用图标 / 平台 Logo 风格保持完全一致
 */
export default function LogoUploader({
  value,
  onChange,
  size = 240,
  buttonText = '上传图标',
  uploadPath = '/api/v1/configs/upload-image',
  uploadPrefix = 'app',
  maxMB = 2,
  tips = ['支持 JPG、PNG 格式', '建议尺寸 256×256'],
  onRemove,
  removeText,
}: {
  value?: string;
  onChange: (url: string) => void;
  size?: number;
  buttonText?: string;
  uploadPath?: string;
  uploadPrefix?: string;
  maxMB?: number;
  tips?: string[];
  onRemove?: () => void;
  removeText?: string;
}) {
  const { message } = AntdApp.useApp();
  const accessToken = useAuthStore((s) => s.accessToken);

  const commonProps = {
    name: 'file',
    action: uploadPath,
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { prefix: uploadPrefix },
    accept: '.png,.jpg,.jpeg,.svg,.webp,.gif',
    showUploadList: false,
    beforeUpload: (file: File) => {
      if (file.size > maxMB * 1024 * 1024) {
        message.error(`图片不能超过 ${maxMB}MB`);
        return Upload.LIST_IGNORE;
      }
      return true;
    },
    onChange: (info: any) => {
      if (info.file.status === 'done') {
        const url = info.file.response?.data?.url;
        if (url) {
          onChange(url);
          message.success('图片已上传');
        }
      } else if (info.file.status === 'error') {
        message.error(info.file.response?.message || '上传失败');
      }
    },
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
      }}
    >
      <Upload {...commonProps}>
        <div
          style={{
            width: size,
            height: size,
            border: '1.5px dashed #c7d2fe',
            borderRadius: 14,
            overflow: 'hidden',
            background: 'linear-gradient(180deg, #fafbff 0%, #eef2ff 100%)',
            cursor: 'pointer',
            transition: 'all 0.2s',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.borderColor = '#1677ff';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.borderColor = '#c7d2fe';
          }}
        >
          {value ? (
            <img src={value} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <>
              <img src="/upload-illust.svg" alt="upload" style={{ width: Math.round(size * 0.58), marginTop: 12 }} />
              <div style={{ textAlign: 'center', marginTop: 16, lineHeight: 1.8 }}>
                {tips.map((t) => (
                  <div key={t} style={{ fontSize: 13.5, color: '#475569' }}>{t}</div>
                ))}
              </div>
            </>
          )}
        </div>
      </Upload>

      <Upload {...commonProps}>
        <Button
          icon={<UploadOutlined />}
          size="large"
          style={{ marginTop: 22, width: 180, height: 44, fontSize: 15, borderRadius: 8 }}
        >
          {buttonText}
        </Button>
      </Upload>

      {value && onRemove && (
        <Button danger style={{ marginTop: 10 }} onClick={onRemove}>
          {removeText || '移除'}
        </Button>
      )}
    </div>
  );
}
