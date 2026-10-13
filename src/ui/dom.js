/**
 * Tiny DOM builder.
 * @param {string} tag
 * @param {Record<string, any>} [attrs] Attributes; `class`, `text`, `html` and `on*` handlers are special.
 * @param {(Node|string|null|false)[]} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function')
      node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Inline SVG paw mark used across the UI. */
export function pawIcon(className = 'paw-icon') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const shapes = [
    ['ellipse', { cx: 32, cy: 42, rx: 15, ry: 12 }],
    ['ellipse', { cx: 14, cy: 26, rx: 6, ry: 8 }],
    ['ellipse', { cx: 25, cy: 15, rx: 6, ry: 8 }],
    ['ellipse', { cx: 39, cy: 15, rx: 6, ry: 8 }],
    ['ellipse', { cx: 50, cy: 26, rx: 6, ry: 8 }],
  ];
  for (const [tag, attrs] of shapes) {
    const s = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, String(v));
    svg.append(s);
  }
  return svg;
}

/**
 * Small stroked SVG icon from path data (24×24 viewBox).
 * @param {string[]} paths
 * @param {string} className
 */
function strokeIcon(paths, className) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

/** Smiling face (emote button). */
export function smileIcon(className = 'touch-icon') {
  return strokeIcon(
    [
      'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z',
      'M8.5 9.5v1.2',
      'M15.5 9.5v1.2',
      'M7.8 14.2c2.2 2.6 6.2 2.6 8.4 0',
    ],
    className,
  );
}

/** Camera (photo mode button). */
export function cameraIcon(className = 'touch-icon') {
  return strokeIcon(
    [
      'M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z',
      'M12 10a3.4 3.4 0 1 0 0 6.8a3.4 3.4 0 1 0 0-6.8z',
    ],
    className,
  );
}
