// 开发/浏览器证据入口（react 打进 bundle，仅用于本地浏览器冒烟，不进生产 client.js）
import { mount, createMockAdapter } from './main.jsx';

const target = document.getElementById('root');
window.__editor = mount(target, { adapter: createMockAdapter() });
