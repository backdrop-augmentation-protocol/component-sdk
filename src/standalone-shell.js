import { createStandaloneEntry } from './runtime.js';

export class StandaloneShell {
  constructor({ manifest, root = document.body, config = {}, render } = {}) {
    this.root = root; this.render = render;
    root.classList.add('bap-standalone-shell');
    root.style.cssText = 'margin:0;min-height:100vh;background:#111;color:#eee;font:14px system-ui,sans-serif;';
    this.surface = document.createElement('main');
    this.surface.dataset.bapComponent = manifest.id;
    this.surface.style.cssText = 'min-height:100vh;box-sizing:border-box;padding:24px;';
    root.append(this.surface);
    this.entry = createStandaloneEntry({ manifest, root: this.surface, config });
    if (render) render(this.surface, this.entry.runtime);
  }
  start() { return this.entry.start(); }
  pause() { return this.entry.pause(); }
  resume() { return this.entry.resume(); }
  stop() { return this.entry.stop(); }
}
