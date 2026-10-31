# BAP Component SDK

[English](README.md) | [简体中文](README.zh-CN.md)

Official MVP SDK for building dual-mode BAP components. A component can run independently in Standalone Mode or inside a compatible host through an Embedded iframe.

## Quick start

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

The official Standalone Shell is an optional convenience. The protocol only requires that Standalone Mode can run as a real component entry point.

## MVP API

- `validateManifest` / `assertManifest`: runtime manifest validation.
- `createEmbeddedEntry`: creates a component runtime for a Host-provided iframe.
- `createStandaloneEntry`: creates a minimal standalone runtime without a shell.
- `StandaloneShell`: optional minimal document shell for examples and development.
- `PostMessageClient`: request/response and event messaging over `postMessage`.
- `ComponentRuntime`: lifecycle (`start`, `pause`, `resume`, `stop`) and configuration APIs.

### Draft 0.2.0 extension support

Embedded components may explicitly offer draft extensions. Only exact Host/Component version intersections are selected; Core-only Hosts remain supported.

```js
const entry = createEmbeddedEntry({ manifest, extensions: [
  { id: 'org.bap.composition', versions: ['0.1.0'] },
  { id: 'org.bap.component-config', versions: ['0.1.0'] },
  { id: 'org.bap.presentation', versions: ['0.1.0'] }
] });

entry.runtime.onConfigChange(config => renderConfig(config));
entry.runtime.onPresentationChange(state => setVisible(state.visible, state.sceneId));
```

When composition is selected, `runtime.instanceId` is the Host-provided opaque routing context. It is not an authentication or origin claim. Host configuration events replace the complete effective snapshot only when their instance ID matches and their revision is newer. Presentation events are likewise instance-scoped.

Run tests with `npm test`. Run the minimal example with `npm run example`, then open `http://localhost:4173`.
