import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { CLOCK, KENNELS, SIGNS, BOUNDS } from './layout.js';
import { PartBuilder } from './props/PartBuilder.js';
import { C } from './props/palette.js';
import { cyl, rbox, torus } from './props/shapes.js';

const ATLAS = 2048;
const PPM = 300;
const FONT = '"Trebuchet MS", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
const ZONE_ACCENTS = {
  Reception: '#2bb3a8',
  Kennels: '#8a83c9',
  'Play Zone': '#4a90e2',
  'Feeding Corner': '#f08a6c',
  'Sunny Nook': '#7fb35f',
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paw(ctx, cx, cy, s, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.18, s * 0.34, s * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const [dx, dy] of [
    [-0.36, -0.2],
    [-0.13, -0.42],
    [0.13, -0.42],
    [0.36, -0.2],
  ]) {
    ctx.beginPath();
    ctx.ellipse(cx + dx * s, cy + dy * s, s * 0.11, s * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function fitText(ctx, text, maxWidth, size, weight = 'bold') {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (ctx.measureText(text).width > maxWidth && s > 8) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
  return s;
}

/** Simple shelf packer. */
class Packer {
  constructor(size) {
    this.size = size;
    this.x = 0;
    this.y = 0;
    this.rowH = 0;
  }
  alloc(w, h) {
    if (this.x + w > this.size) {
      this.x = 0;
      this.y += this.rowH + 4;
      this.rowH = 0;
    }
    const r = { x: this.x, y: this.y, w, h };
    this.x += w + 4;
    this.rowH = Math.max(this.rowH, h);
    if (this.y + h > this.size) throw new Error('Signage atlas overflow');
    return r;
  }
}

const DRAW = {
  zone(ctx, r, text) {
    const accent = ZONE_ACCENTS[text] || '#2bb3a8';
    ctx.fillStyle = '#fff6e5';
    roundRect(ctx, r.x, r.y, r.w, r.h, r.h * 0.18);
    ctx.fill();
    ctx.fillStyle = accent;
    roundRect(ctx, r.x, r.y, r.h * 0.9, r.h, r.h * 0.18);
    ctx.fill();
    ctx.fillRect(r.x + r.h * 0.6, r.y, r.h * 0.3, r.h);
    paw(ctx, r.x + r.h * 0.45, r.y + r.h * 0.52, r.h * 0.62, '#fff6e5');
    const size = fitText(ctx, text, r.w - r.h * 1.25, r.h * 0.56);
    ctx.fillStyle = '#2d3a6b';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${size}px ${FONT}`;
    ctx.fillText(text, r.x + r.h * 1.08, r.y + r.h * 0.54);
  },
  logo(ctx, r) {
    ctx.fillStyle = '#2bb3a8';
    roundRect(ctx, r.x, r.y, r.w, r.h, r.h * 0.22);
    ctx.fill();
    ctx.strokeStyle = '#fff6e5';
    ctx.lineWidth = r.h * 0.04;
    roundRect(ctx, r.x + r.h * 0.06, r.y + r.h * 0.06, r.w - r.h * 0.12, r.h * 0.88, r.h * 0.18);
    ctx.stroke();
    ctx.fillStyle = '#ff8a3d';
    ctx.beginPath();
    ctx.arc(r.x + r.h * 0.55, r.y + r.h * 0.5, r.h * 0.33, 0, Math.PI * 2);
    ctx.fill();
    paw(ctx, r.x + r.h * 0.55, r.y + r.h * 0.52, r.h * 0.42, '#fff6e5');
    ctx.fillStyle = '#fff6e5';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const s1 = fitText(ctx, 'Happy Paws', r.w - r.h * 1.3, r.h * 0.42);
    ctx.font = `bold ${s1}px ${FONT}`;
    ctx.fillText('Happy Paws', r.x + r.h * 1.05, r.y + r.h * 0.55);
    const sub = 'ANIMAL SHELTER · EST. 2026';
    const s2 = fitText(ctx, sub, r.w - r.h * 1.3, Math.round(s1 * 0.42));
    ctx.font = `bold ${s2}px ${FONT}`;
    ctx.fillStyle = '#ffe1a8';
    ctx.fillText(sub, r.x + r.h * 1.08, r.y + r.h * 0.82);
  },
  door(ctx, r, text) {
    ctx.fillStyle = '#2d3a6b';
    roundRect(ctx, r.x, r.y, r.w, r.h, r.h * 0.25);
    ctx.fill();
    const size = fitText(ctx, text, r.w * 0.86, r.h * 0.6);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${size}px ${FONT}`;
    ctx.fillText(text, r.x + r.w / 2, r.y + r.h * 0.54);
  },
  exit(ctx, r, text) {
    ctx.fillStyle = '#17b65a';
    roundRect(ctx, r.x, r.y, r.w, r.h, r.h * 0.15);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${r.h * 0.66}px ${FONT}`;
    ctx.fillText(`${text} →`, r.x + r.w / 2, r.y + r.h * 0.54);
  },
  chart(ctx, r, text) {
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, r.x, r.y, r.w, r.h, r.h * 0.04);
    ctx.fill();
    ctx.strokeStyle = '#c9ced6';
    ctx.lineWidth = r.h * 0.02;
    ctx.stroke();
    ctx.fillStyle = '#2d3a6b';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const s = fitText(ctx, text, r.w * 0.9, r.h * 0.12);
    ctx.font = `bold ${s}px ${FONT}`;
    ctx.fillText(text, r.x + r.w * 0.05, r.y + r.h * 0.11);
    const rows = text.startsWith('Feed')
      ? [
          ['8:00', 'Breakfast', '#ffcf4a'],
          ['12:30', 'Snack', '#a8e6cf'],
          ['18:00', 'Dinner', '#ff8a3d'],
          ['20:00', 'Water check', '#8fd3ff'],
        ]
      : [
          ['1', 'Share the toys', '#ff6b6b'],
          ['2', 'Paws on the ramps', '#4a90e2'],
          ['3', 'Gentle barking only', '#8f6bd8'],
          ['4', 'Have fun!', '#6cc070'],
        ];
    rows.forEach(([a, b, color], i) => {
      const y = r.y + r.h * (0.3 + i * 0.17);
      ctx.fillStyle = color;
      roundRect(ctx, r.x + r.w * 0.05, y - r.h * 0.06, r.w * 0.9, r.h * 0.12, r.h * 0.03);
      ctx.fill();
      ctx.fillStyle = '#2d3a6b';
      ctx.font = `bold ${r.h * 0.075}px ${FONT}`;
      ctx.fillText(a, r.x + r.w * 0.08, y);
      ctx.font = `${r.h * 0.075}px ${FONT}`;
      ctx.fillText(b, r.x + r.w * 0.3, y);
    });
  },
  poster(ctx, r, text) {
    const palettes = {
      Adopt: ['#ffcf4a', '#2d3a6b', 'ADOPT ME!'],
      Walks: ['#8fd3ff', '#2d3a6b', 'Walks 10am'],
      Volunteer: ['#ff9fb8', '#2d3a6b', 'Volunteer!'],
      'Lost?': ['#a8e6cf', '#2d3a6b', 'Lost pet?'],
    };
    const [bg, fg, label] = palettes[text] || ['#ffffff', '#2d3a6b', text];
    ctx.fillStyle = bg;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    // A friendly dog face.
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h * 0.42;
    const s = Math.min(r.w, r.h) * 0.3;
    ctx.fillStyle = '#c98d5a';
    ctx.beginPath();
    ctx.ellipse(cx - s * 0.85, cy - s * 0.2, s * 0.35, s * 0.6, 0.3, 0, Math.PI * 2);
    ctx.ellipse(cx + s * 0.85, cy - s * 0.2, s * 0.35, s * 0.6, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2d1a8';
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2d2a2e';
    for (const dx of [-0.3, 0.3]) {
      ctx.beginPath();
      ctx.arc(cx + dx * s, cy - s * 0.1, s * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(cx, cy + s * 0.2, s * 0.15, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fs = fitText(ctx, label, r.w * 0.9, r.h * 0.14);
    ctx.font = `bold ${fs}px ${FONT}`;
    ctx.fillText(label, cx, r.y + r.h * 0.86);
  },
  plaque(ctx, r, text) {
    ctx.fillStyle = '#fff6e5';
    roundRect(ctx, r.x, r.y, r.w, r.h, r.h * 0.3);
    ctx.fill();
    ctx.strokeStyle = '#2bb3a8';
    ctx.lineWidth = r.h * 0.08;
    roundRect(ctx, r.x + r.h * 0.06, r.y + r.h * 0.06, r.w - r.h * 0.12, r.h * 0.88, r.h * 0.25);
    ctx.stroke();
    paw(ctx, r.x + r.h * 0.5, r.y + r.h * 0.52, r.h * 0.5, '#ff8a3d');
    ctx.fillStyle = '#2d3a6b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const s = fitText(ctx, text, r.w - r.h * 1.2, r.h * 0.52);
    ctx.font = `bold ${s}px ${FONT}`;
    ctx.fillText(text, r.x + r.w / 2 + r.h * 0.25, r.y + r.h * 0.54);
  },
  clock(ctx, r) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const R = r.w / 2 - 2;
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2d3a6b';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const big = i % 5 === 0;
      const l = big ? R * 0.12 : R * 0.05;
      ctx.save();
      ctx.translate(cx + Math.sin(a) * (R * 0.9), cy - Math.cos(a) * (R * 0.9));
      ctx.rotate(a);
      ctx.fillRect(big ? -R * 0.018 : -R * 0.007, 0, big ? R * 0.036 : R * 0.014, l);
      ctx.restore();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${R * 0.2}px ${FONT}`;
    for (const [n, a] of [
      ['12', 0],
      ['3', 0.25],
      ['6', 0.5],
      ['9', 0.75],
    ]) {
      const t = a * Math.PI * 2;
      ctx.fillText(n, cx + Math.sin(t) * R * 0.66, cy - Math.cos(t) * R * 0.66);
    }
    paw(ctx, cx, cy + R * 0.35, R * 0.22, '#ff8a3d');
  },
};

/**
 * All text signage (zone signs, logo, door plaques, EXIT signs, charts,
 * posters, kennel name plaques) and the animated wall clock. Text is drawn
 * once into a canvas atlas; every sign quad samples it, so all signs render
 * in one draw call (plus one for the emissive EXIT signs).
 */
export class Signage {
  /** @param {import('./MaterialLibrary.js').MaterialLibrary} materials */
  constructor(materials) {
    this.group = new Group();
    this.group.name = 'Signage';
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS;
    canvas.height = ATLAS;
    const ctx = canvas.getContext('2d');
    const packer = new Packer(ATLAS);

    const items = SIGNS.map((s) => ({ ...s }));
    for (const k of KENNELS) {
      items.push({
        text: k.name,
        style: 'plaque',
        x: k.x + 0.95,
        y: 1.02,
        z: k.frontZ + k.facing * 0.04,
        rotY: k.facing > 0 ? 0 : Math.PI,
        w: 0.46,
        h: 0.16,
      });
    }
    items.push({
      text: '',
      style: 'clock',
      x: CLOCK.x,
      y: CLOCK.y,
      z: CLOCK.z,
      rotY: CLOCK.rotY,
      w: CLOCK.radius * 2,
      h: CLOCK.radius * 2,
    });

    for (const item of items) {
      const pw = Math.min(ATLAS, Math.round(item.w * PPM));
      const ph = Math.min(ATLAS, Math.round(item.h * PPM));
      item.rect = packer.alloc(pw, ph);
      DRAW[item.style](ctx, item.rect, item.text);
    }

    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.generateMipmaps = true;

    const faces = new PartBuilder({ groundAO: 0 });
    const glowFaces = new PartBuilder({ groundAO: 0 });
    const boards = new PartBuilder({ groundAO: 0 });

    /** Sign quad sampling the item's atlas rect; `back` faces the other way (still readable). */
    const quad = (item, offset, back) => {
      const g = new PlaneGeometry(item.w, item.h);
      const uv = g.attributes.uv;
      const { x, y, w, h } = item.rect;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (x + uv.getX(i) * w) / ATLAS, 1 - (y + (1 - uv.getY(i)) * h) / ATLAS);
      }
      g.translate(0, 0, offset);
      if (back) g.rotateY(Math.PI);
      return g;
    };

    for (const item of items) {
      const target = item.style === 'exit' ? glowFaces : faces;
      const opts = { position: [item.x, item.y, item.z], rotation: [0, item.rotY, 0], noAO: true };
      if (item.style === 'clock') continue;
      if (item.hang) {
        target.add('sign', quad(item, 0.031, false), opts);
        target.add('sign', quad(item, 0.031, true), opts);
        boards.add('paint', rbox(item.w + 0.1, item.h + 0.1, 0.05, 0.025), {
          color: C.navy,
          ...opts,
        });
        for (const sx of [-1, 1]) {
          const len = BOUNDS.ceiling - (item.y + item.h / 2);
          const ox = sx * (item.w / 2 - 0.05);
          const c = Math.cos(item.rotY);
          const s = Math.sin(item.rotY);
          boards.add('metal', cyl(0.008, 0.008, len, 6), {
            color: C.gunmetal,
            position: [item.x + ox * c, item.y + item.h / 2 + len / 2, item.z - ox * s],
            noAO: true,
          });
        }
      } else if (item.style === 'exit') {
        boards.add('paint', rbox(item.w + 0.06, item.h + 0.06, 0.06, 0.02), {
          color: C.white,
          ...opts,
        });
        target.add('sign', quad(item, 0.031, false), opts);
      } else {
        target.add('sign', quad(item, 0.012, false), opts);
      }
    }

    const signMaterial = new MeshStandardMaterial({
      name: 'sign',
      map: this.texture,
      roughness: 0.55,
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const glowMaterial = new MeshBasicMaterial({
      name: 'signGlow',
      map: this.texture,
      color: new Color(1.8, 1.8, 1.8),
      vertexColors: true,
    });
    this.materials = [signMaterial, glowMaterial];
    const addMesh = (builder, materialFor, keepUV) => {
      for (const [slot, geometry] of Object.entries(builder.build({ keepUV: () => keepUV }))) {
        const mesh = new Mesh(geometry, materialFor(slot));
        mesh.name = `signage:${slot}`;
        mesh.matrixAutoUpdate = false;
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
    };
    addMesh(faces, () => signMaterial, true);
    addMesh(glowFaces, () => glowMaterial, true);
    addMesh(boards, (slot) => materials.get(slot), false);

    // Clock: face, rim and two hands that follow the player's local time.
    const clockItem = items[items.length - 1];
    this.clock = new Object3D();
    this.clock.position.set(CLOCK.x, CLOCK.y, CLOCK.z);
    this.clock.rotation.y = CLOCK.rotY;
    // Built through PartBuilder so it carries the white vertex colours the
    // (vertex-coloured) sign material expects.
    const faceBuilder = new PartBuilder({ groundAO: 0 });
    faceBuilder.add('sign', quad(clockItem, 0.02, false), { noAO: true });
    const face = new Mesh(faceBuilder.build({ keepUV: () => true }).sign, signMaterial);
    const rimBuilder = new PartBuilder({ groundAO: 0 });
    rimBuilder.add('paint', torus(CLOCK.radius, 0.03, 8, 40), {
      color: C.teal,
      position: [0, 0, 0.02],
    });
    const rim = new Mesh(rimBuilder.build({ keepUV: () => false }).paint, materials.get('paint'));
    const handMaterial = new MeshStandardMaterial({ color: 0x2d3a6b, roughness: 0.5 });
    this.materials.push(handMaterial);
    const handGeo = (len, width) =>
      new BoxGeometry(width, len, 0.012).translate(0, len / 2 - 0.02, 0);
    this.hourHand = new Mesh(handGeo(CLOCK.radius * 0.5, 0.03), handMaterial);
    this.minuteHand = new Mesh(handGeo(CLOCK.radius * 0.78, 0.02), handMaterial);
    this.hourHand.position.z = 0.03;
    this.minuteHand.position.z = 0.038;
    this.clock.add(face, rim, this.hourHand, this.minuteHand);
    this.group.add(this.clock);
    this._clockTimer = 0;
  }

  /**
   * Advance the clock hands (once per second is plenty).
   * @param {number} dt
   */
  update(dt) {
    this._clockTimer -= dt;
    if (this._clockTimer > 0) return;
    this._clockTimer = 1;
    const now = new Date();
    const minutes = now.getMinutes() + now.getSeconds() / 60;
    const hours = (now.getHours() % 12) + minutes / 60;
    this.minuteHand.rotation.z = -(minutes / 60) * Math.PI * 2;
    this.hourHand.rotation.z = -(hours / 12) * Math.PI * 2;
  }

  dispose() {
    this.texture.dispose();
    for (const m of this.materials) m.dispose();
    this.group.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
  }
}
