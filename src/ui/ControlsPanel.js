import { el } from './dom.js';

const key = (...labels) =>
  el(
    'span',
    { class: 'keys' },
    labels.map((l) => el('kbd', { text: l })),
  );

const SECTIONS = [
  {
    title: 'Keyboard & mouse',
    rows: [
      [key('W', 'A', 'S', 'D'), 'Move (relative to camera)'],
      [key('Shift'), 'Sprint / gallop'],
      [key('Space'), 'Jump (hold for higher)'],
      [key('E'), 'Bark'],
      [key('Q'), 'Emote wheel (hold, point, release; tap to keep open)'],
      [key('1–7'), 'Emotes directly'],
      [key('P'), 'Photo mode'],
      [key('Drag'), 'Orbit camera (left or right button)'],
      [key('Wheel'), 'Zoom'],
      [key('Esc'), 'Pause menu'],
      [key('F3'), 'Performance overlay'],
    ],
  },
  {
    title: 'Gamepad',
    rows: [
      [key('L-stick'), 'Move'],
      [key('R-stick'), 'Orbit camera'],
      [key('A'), 'Jump'],
      [key('RT'), 'Sprint'],
      [key('X'), 'Bark'],
      [key('Y'), 'Emote wheel (hold, point a stick, release)'],
      [key('View'), 'Photo mode'],
      [key('RB', 'LT'), 'Zoom in / out'],
      [key('R3'), 'Recenter camera'],
      [key('Start'), 'Pause'],
      [key('D-pad', 'A', 'B'), 'Menus: move, select, back'],
    ],
  },
  {
    title: 'Touch',
    rows: [
      [key('Left side'), 'Virtual joystick (push to the edge to sprint)'],
      [key('Right side'), 'Drag to orbit the camera'],
      [key('⤒'), 'Jump'],
      [key('🐾'), 'Bark'],
      [key('☺'), 'Emote wheel'],
      [key('📷'), 'Photo mode'],
      [key('II'), 'Pause'],
    ],
  },
  {
    title: 'Photo mode',
    rows: [
      [key('W', 'A', 'S', 'D'), 'Fly (Shift: faster)'],
      [key('E', 'Q'), 'Up / down (gamepad RT / LT)'],
      [key('Drag'), 'Look around (gamepad R-stick)'],
      [key('Wheel'), 'Field of view (gamepad RB / LB)'],
      [key('F'), 'Focus on the pup (gamepad R3)'],
      [key('C'), 'Capture PNG (gamepad X)'],
      [key('H'), 'Hide / show UI (gamepad Y)'],
      [key('Esc', 'P'), 'Exit (gamepad B)'],
    ],
  },
];

/** Read-only controls reference (keyboard/mouse, gamepad, touch). */
export class ControlsPanel {
  /** @param {{onBack: () => void}} deps */
  constructor({ onBack }) {
    this.root = el(
      'section',
      {
        class: 'panel panel-controls',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'controls-title',
      },
      [
        el('h2', { id: 'controls-title', text: 'Controls' }),
        el(
          'div',
          { class: 'controls-grid' },
          SECTIONS.map((section) =>
            el('div', { class: 'controls-section' }, [
              el('h3', { text: section.title }),
              el(
                'dl',
                {},
                section.rows.flatMap(([keys, desc]) => [
                  el('dt', {}, [keys]),
                  el('dd', { text: desc }),
                ]),
              ),
            ]),
          ),
        ),
        el('div', { class: 'panel-actions' }, [
          el('button', { class: 'btn btn-primary', type: 'button', text: 'Back', onclick: onBack }),
        ]),
      ],
    );
  }

  dispose() {
    this.root.remove();
  }
}
