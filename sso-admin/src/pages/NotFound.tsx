import { Result, Button } from 'antd';
import { useNavigate } from 'react-router-dom';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="404"
      subTitle="抱歉，页面不存在或访问受限"
      extra={
        <Button type="primary" onClick={() => navigate('/portal')}>
          返回门户
        </Button>
      }
    />
  );
}
