import { Events } from './EventBus.js';

/**
 * Lifetime play statistics kept in the save's `progress.stats` section:
 * play time, distance travelled, jumps, barks, photos and emotes performed.
 * Shown in Settings › Progress (and erased by "Reset Progress").
 */
export class StatsTracker {
  /**
   * @param {object} deps
   * @param {import('./EventBus.js').EventBus} deps.bus
   * @param {import('./SaveManager.js').SaveManager} deps.save
   */
  constructor({ bus, save }) {
    this.save = save;
    this._last = null;
    const bump = (key) => () => {
      this.stats[key]++;
      save.markDirty();
    };
    this._unsubs = [
      bus.on(Events.PLAYER_JUMP, bump('jumps')),
      bus.on(Events.PLAYER_BARK, bump('barks')),
      bus.on(Events.PHOTO_CAPTURED, bump('photos')),
      bus.on(Events.EMOTE_START, ({ id }) => {
        this.stats.emotes[id] = (this.stats.emotes[id] || 0) + 1;
        save.markDirty();
      }),
    ];
  }

  /** The live stats object (replaced when progress is reset). */
  get stats() {
    return this.save.progress.stats;
  }

  /**
   * Accumulate time and distance while playing.
   * @param {number} dt
   * @param {import('three').Vector3} position Pup feet position.
   */
  update(dt, position) {
    const s = this.stats;
    s.playTime += dt;
    if (this._last) {
      const d = Math.hypot(position.x - this._last.x, position.z - this._last.z);
      // Ignore respawns and teleports.
      if (d < 1) s.distance += d;
      this._last.x = position.x;
      this._last.z = position.z;
    } else {
      this._last = { x: position.x, z: position.z };
    }
    this.save.markDirty();
  }

  /** Forget the last position (after a respawn or a pause). */
  resetTracking() {
    this._last = null;
  }

  dispose() {
    for (const u of this._unsubs) u();
  }
}

/**
 * Human-readable summary of the stats object.
 * @param {ReturnType<typeof import('./SaveManager.js').defaultProgress>['stats']} s
 * @returns {[string, string][]} Label/value pairs.
 */
export function describeStats(s) {
  const minutes = Math.floor(s.playTime / 60);
  const time =
    minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
  const emotes = Object.values(s.emotes).reduce((a, b) => a + b, 0);
  return [
    ['Play time', time],
    [
      'Distance',
      s.distance >= 1000 ? `${(s.distance / 1000).toFixed(2)} km` : `${Math.round(s.distance)} m`,
    ],
    ['Jumps', String(s.jumps)],
    ['Barks', String(s.barks)],
    ['Emotes', String(emotes)],
    ['Photos', String(s.photos)],
  ];
}
