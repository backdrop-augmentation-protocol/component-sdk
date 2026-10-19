# BAP Component SDK

[English](README.md) | 简体中文

用于构建 BAP 双模式组件的官方 MVP SDK。组件可以在 Standalone Mode 中独立
运行，也可以通过 Embedded iframe 运行在兼容 Host 中。

## 快速开始

```js
import { StandaloneShell } from '@bap/component-sdk';

const manifest = {
  manifestVersion: '0.1', id: 'example.clock', name: 'Example Clock', version: '0.1.0',
  entry: { embedded: './component.js', standalone: './component.js' }
};

new StandaloneShell({ manifest, render(root, runtime) {
  root.textContent = runtime.getConfig('label') ?? 'Hello BAP';
} }).start();
```

官方 Standalone Shell 是可选的便利工具。协议只要求 Standalone Mode 能够
作为真实组件入口运行。

## MVP API

- `validateManifest` / `assertManifest`：运行时 Manifest 校验；
- `createEmbeddedEntry`：为 Host 提供的 iframe 创建组件运行时；
- `createStandaloneEntry`：不依赖 Shell 创建最小独立运行时；
- `StandaloneShell`：供示例和开发使用的可选最小文档外壳；
- `PostMessageClient`：通过 `postMessage` 实现请求/响应和事件通信；
- `ComponentRuntime`：生命周期（`start`、`pause`、`resume`、`stop`）和配置 API。

使用 `npm test` 运行测试。使用 `npm run example` 运行最小示例，然后打开
`http://localhost:4173`。
