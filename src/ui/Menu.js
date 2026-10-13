import { Events } from '../core/EventBus.js';
import { ControlsPanel } from './ControlsPanel.js';
import { el, pawIcon } from './dom.js';
import { SettingsPanel } from './SettingsPanel.js';

/**
 * Start menu (Play / Settings / Controls) and pause menu (Resume / Photo
 * mode / Settings / Controls / Quit to title), with Settings and Controls as
 * sub-panels. Buttons only emit request events; the Engine owns the game state.
 */
export class Menu {
  /**
   * @param {object} deps
   * @param {HTMLElement} deps.root
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('../core/SettingsStore.js').SettingsStore} deps.settings
   * @param {import('../core/SaveManager.js').SaveManager} deps.save
   * @param {() => string} deps.detectedQuality
   */
  constructor({ root, bus, settings, save, detectedQuality }) {
    this.bus = bus;
    this.mode = null;
    this.sub = null;

    const button = (text, onClick, primary = false) =>
      el('button', {
        class: `btn ${primary ? 'btn-primary btn-large' : 'btn-secondary'}`,
        type: 'button',
        text,
        onclick: () => {
          bus.emit(Events.UI_SOUND, 'click');
          onClick();
        },
        onpointerenter: () => bus.emit(Events.UI_SOUND, 'hover'),
      });

    this.title = el('header', { class: 'menu-title' }, [
      el('div', { class: 'menu-logo' }, [pawIcon('menu-paw')]),
      el('h1', {}, [
        el('span', { class: 'title-robo', text: 'Robo' }),
        el('span', { class: 'title-pup', text: 'Pup' }),
      ]),
      el('p', { class: 'menu-subtitle', text: 'Shelter Day' }),
    ]);

    this.startButtons = el('nav', { class: 'menu-buttons', 'aria-label': 'Main menu' }, [
      button('Play', () => bus.emit(Events.UI_REQUEST_PLAY), true),
      button('Settings', () => this.openSub('settings')),
      button('Controls', () => this.openSub('controls')),
    ]);
    this.pauseButtons = el('nav', { class: 'menu-buttons', 'aria-label': 'Pause menu' }, [
      button('Resume', () => bus.emit(Events.UI_REQUEST_RESUME), true),
      button('Photo mode', () => bus.emit(Events.UI_REQUEST_PHOTO)),
      button('Settings', () => this.openSub('settings')),
      button('Controls', () => this.openSub('controls')),
      button('Quit to title', () => bus.emit(Events.UI_REQUEST_QUIT)),
    ]);
    this.pauseLabel = el('p', { class: 'menu-paused', text: 'Paused' });
    this.footer = el('p', {
      class: 'menu-footer',
      text: 'Explore the shelter, play with toys, make friends. Woof!',
    });

    this.main = el('section', { class: 'panel panel-menu' }, [
      this.title,
      this.pauseLabel,
      this.startButtons,
      this.pauseButtons,
      this.footer,
    ]);
    this.settings = new SettingsPanel({
      bus,
      settings,
      save,
      detectedQuality,
      onBack: () => this.closeSub(),
    });
    this.controls = new ControlsPanel({ onBack: () => this.closeSub() });

    this.root = el('div', { class: 'menu-layer', hidden: true }, [
      this.main,
      this.settings.root,
      this.controls.root,
    ]);
    root.append(this.root);
    this._render();
  }

  /** @returns {boolean} */
  get isOpen() {
    return this.mode !== null;
  }

  /** The visible panel while open (gamepad navigation root), else null. */
  get activePanel() {
    if (this.mode === null) return null;
    if (this.sub === 'settings') return this.settings.root;
    if (this.sub === 'controls') return this.controls.root;
    return this.main;
  }

  showStart() {
    this.mode = 'start';
    this.sub = null;
    this._render();
  }

  showPause() {
    this.mode = 'pause';
    this.sub = null;
    this._render();
  }

  hide() {
    this.mode = null;
    this.sub = null;
    this._render();
  }

  /** @param {'settings'|'controls'} name */
  openSub(name) {
    this.sub = name;
    if (name === 'settings') this.settings.refresh();
    this._render();
  }

  closeSub() {
    this.sub = null;
    this._render();
  }

  /**
   * Handle Esc/Start inside menus.
   * @returns {boolean} true if a sub-panel was closed.
   */
  back() {
    if (this.sub) {
      this.closeSub();
      return true;
    }
    return false;
  }

  _render() {
    const open = this.mode !== null;
    this.root.hidden = !open;
    this.root.classList.toggle('is-pause', this.mode === 'pause');
    this.main.hidden = !open || this.sub !== null;
    this.settings.root.hidden = this.sub !== 'settings';
    this.controls.root.hidden = this.sub !== 'controls';
    this.startButtons.hidden = this.mode !== 'start';
    this.pauseButtons.hidden = this.mode !== 'pause';
    this.pauseLabel.hidden = this.mode !== 'pause';
    this.footer.hidden = this.mode !== 'start';
    if (!open) return;
    const panel =
      this.sub === 'settings'
        ? this.settings.root
        : this.sub === 'controls'
          ? this.controls.root
          : this.main;
    // Focus the first visible control (hidden button groups come first in the DOM).
    const focusable = [...panel.querySelectorAll('button, select, input')].find(
      (el) => el.offsetParent !== null,
    );
    if (focusable) focusable.focus({ preventScroll: true });
  }

  dispose() {
    this.settings.dispose();
    this.controls.dispose();
    this.root.remove();
  }
}
