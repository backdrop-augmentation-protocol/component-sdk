# BAP Component SDK

Official MVP SDK for building dual-mode BAP components. A component can run independently in Standalone Mode or inside a compatible host through an Embedded iframe.

## Quick start

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

The official Standalone Shell is an optional convenience. The protocol only requires that Standalone Mode can run as a real component entry point.

## MVP API

- `validateManifest` / `assertManifest`: runtime manifest validation.
- `createEmbeddedEntry`: creates a component runtime for a Host-provided iframe.
- `createStandaloneEntry`: creates a minimal standalone runtime without a shell.
- `StandaloneShell`: optional minimal document shell for examples and development.
- `PostMessageClient`: request/response and event messaging over `postMessage`.
- `ComponentRuntime`: lifecycle (`start`, `pause`, `resume`, `stop`) and configuration APIs.

Run tests with `npm test`. Run the minimal example with `npm run example`, then open `http://localhost:4173`.
