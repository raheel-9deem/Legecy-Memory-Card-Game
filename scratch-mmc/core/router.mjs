/**
 * router.js — Single-page screen router.
 *
 * Screens are loaded on demand with dynamic `import()` (no page reload),
 * cached after first use, and rendered into their own <section>.
 *
 * A screen module default-exports:
 *   {
 *     title:  string,
 *     header: { show, home, pause, timer, moves, level },
 *     render(params) -> HTML string,
 *     mount(el, params, ctx),   // optional
 *     unmount(el)               // optional
 *   }
 */

import { bus, EVENTS } from './events.mjs';

export class Router {
  /**
   * @param {{routes: object, header: object, defaultRoute: string}} config
   */
  constructor({ routes, header, defaultRoute = 'menu' }) {
    this.routes = routes;
    this.header = header;
    this.defaultRoute = defaultRoute;
    this.current = null;       // { name, module, el, params }
    this.history = [];
    this._modules = new Map();
    this._navigating = false;

    window.addEventListener('hashchange', () => this._onHashChange());
  }

  /** Boot from the current URL hash (or the default route). */
  start() {
    const { name } = this._parseHash();
    const route = this.routes[name] ? name : this.defaultRoute;
    return this.navigate(route, {}, { replace: true });
  }

  _parseHash() {
    const raw = window.location.hash.replace(/^#\/?/, '').trim();
    return { name: raw.split('?')[0] || this.defaultRoute };
  }

  _onHashChange() {
    if (this._navigating) return;                 // our own push
    const { name } = this._parseHash();
    if (!this.current || this.current.name !== name) {
      this.navigate(this.routes[name] ? name : this.defaultRoute, {}, { fromHash: true });
    }
  }

  async _loadModule(name) {
    if (this._modules.has(name)) return this._modules.get(name);
    const route = this.routes[name];
    const mod = (await route.loader()).default;
    this._modules.set(name, mod);
    return mod;
  }

  /**
   * Swap to another screen.
   * @param {string} name
   * @param {object} params  passed to render()/mount()
   */
  async navigate(name, params = {}, { replace = false, fromHash = false } = {}) {
    const route = this.routes[name];
    if (!route) {
      console.warn(`[router] unknown route "${name}"`);
      return;
    }
    if (this._navigating) return;
    this._navigating = true;

    try {
      const module = await this._loadModule(name);
      const el = document.getElementById(route.elementId);
      if (!el) throw new Error(`missing container #${route.elementId}`);

      // ---- leave current ----
      if (this.current) {
        const prev = this.current;
        bus.emit(EVENTS.SCREEN_LEAVE, { name: prev.name });
        if (typeof prev.module.unmount === 'function') {
          try { prev.module.unmount(prev.el); } catch (err) { console.error(err); }
        }
        prev.el.classList.add('leave');
        await wait(180);
        prev.el.classList.remove('active', 'leave');
        prev.el.innerHTML = '';
        if (!replace) this.history.push({ name: prev.name, params: prev.params });
      }

      // ---- enter next ----
      el.innerHTML = typeof module.render === 'function' ? module.render(params) : '';
      el.classList.add('active', 'enter');

      if (this.header && typeof this.header.apply === 'function') {
        this.header.apply(module.header || {}, { title: module.title, params });
      }

      this.current = { name, module, el, params };

      if (typeof module.mount === 'function') {
        await module.mount(el, params, this);
      }

      if (!fromHash) {
        this._setHash(name, replace);
      }

      // Clear the enter class once the animation has played.
      wait(460).then(() => el.classList.remove('enter'));

      bus.emit(EVENTS.SCREEN_ENTER, { name, params });
      bus.emit(EVENTS.NAVIGATE, { name, params });
    } catch (err) {
      console.error(`[router] failed to navigate to "${name}":`, err);
    } finally {
      this._navigating = false;
    }
  }

  _setHash(name, replace) {
    const target = `#/${name}`;
    if (window.location.hash === target) return;
    if (replace && window.history.replaceState) {
      window.history.replaceState(null, '', target);
    } else {
      window.location.hash = target;
    }
  }

  /** Go back to the previous screen (or the default route). */
  back() {
    const prev = this.history.pop();
    if (prev) return this.navigate(prev.name, prev.params, { replace: true });
    return this.navigate(this.defaultRoute, {}, { replace: true });
  }

  get currentName() { return this.current ? this.current.name : null; }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Route table — each screen is a lazily imported ES module. */
export const ROUTES = {
  menu:   { elementId: 'screen-menu',         loader: () => import('../screens/menu.mjs') },
  levels: { elementId: 'screen-level-select', loader: () => import('../screens/level-select.mjs') },
  game:   { elementId: 'screen-gameplay',     loader: () => import('../screens/gameplay.mjs') },
  store:  { elementId: 'screen-store',        loader: () => import('../screens/store.mjs') },
  win:    { elementId: 'screen-win',          loader: () => import('../screens/win.mjs') },
};
