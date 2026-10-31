# BAP Component SDK

[English](README.md) | 简体中文

用于构建 BAP 双模式组件的官方 MVP SDK。组件可以在 Standalone Mode 中独立
运行，也可以通过 Embedded iframe 运行在兼容 Host 中。

## 快速开始

```js
import { StandaloneShell } from '@backdrop-augmentation-protocol/component-sdk';

const manifest = {
  protocol: { name: 'bap', version: '0.1.0', profile: 'core' },
  id: 'example.clock', name: 'Example Clock', version: '0.1.0',
  role: 'component', capabilities: [], modes: ['standalone', 'embedded'],
  entrypoints: {
    default: './component.js',
    embedded: './component.js',
    standalone: './component.js'
  }
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

### 草案 0.2.0 扩展支持

嵌入式组件可以显式声明支持的草案扩展。只有 Host 与 Component 版本完全匹配时才会协商选中；仍兼容仅支持 Core 的 Host。

```js
const entry = createEmbeddedEntry({ manifest, extensions: [
  { id: 'org.bap.composition', versions: ['0.1.0'] },
  { id: 'org.bap.component-config', versions: ['0.1.0'] },
  { id: 'org.bap.presentation', versions: ['0.1.0'] }
] });

entry.runtime.onConfigChange(config => renderConfig(config));
entry.runtime.onPresentationChange(state => setVisible(state.visible, state.sceneId));
```

选中 composition 后，`runtime.instanceId` 是 Host 提供的不透明路由上下文，不代表身份认证或来源证明。Host 配置事件仅在实例 ID 匹配且修订号更新时替换完整有效快照。呈现事件同样按实例隔离。

使用 `npm test` 运行测试。使用 `npm run example` 运行最小示例，然后打开
`http://localhost:4173`。
