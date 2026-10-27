/**
 * 7CAST - Icon Component & Loader
 * Uses dev7seen/7ui-icons library
 */

const iconCache = new Map();

export async function loadIcon(name) {
  if (iconCache.has(name)) {
    return iconCache.get(name);
  }

  // Common file name mapping
  const fileMap = {
    'video': 'Video.svg',
    'monitor': 'Monitor.svg',
    'flash': 'Flash.svg',
    'tick': 'Tick-Circle.svg',
    'cross': 'X-Circle.svg',
    'setting': 'Setting.svg',
    'trash': 'Trash Bin.svg',
    'edit': 'Edit.svg',
    'copy': 'Copy.svg',
    'key': 'Key.svg',
    'lock': 'Lock.svg',
    'unlock': 'Unlock.svg',
    'login': 'Login.svg',
    'logout': 'Logout.svg',
    'tv': 'TV.svg',
    'rocket': 'Rocket.svg',
    'chart': 'Chart.svg',
    'volume-high': 'Volume-High.svg',
    'volume-low': 'Volume-Low.svg',
    'volume': 'Volume.svg',
    'shield': 'Shield-Done.svg',
    'warning': 'Attention-Triangle.svg',
    'info': 'Info-Circle.svg',
    'arrow-right': 'Arrow-Right.svg',
    'arrow-left': 'Arrow-Left.svg',
    'arrow-down': 'Arrow-Down.svg',
    'download': 'Download.svg',
    'upload': 'Upload.svg',
    'category': 'Category.svg',
    'bell': 'Bell.svg',
    'search': 'Search.svg',
    'clock': 'Clock.svg',
    'save': 'Save.svg'
  };

  const filename = fileMap[name.toLowerCase()] || `${name}.svg`;
  try {
    const res = await fetch(`/assets/icons/${encodeURIComponent(filename)}`);
    if (res.ok) {
      const svg = await res.text();
      iconCache.set(name, svg);
      return svg;
    }
  } catch (e) {
    console.warn(`Icon ${name} could not be loaded:`, e);
  }

  return '';
}

export function renderIcon(name, size = 20, className = '') {
  const filename = name.includes('.svg') ? name : `${name}.svg`;
  return `<img src="/assets/icons/${encodeURIComponent(filename)}" width="${size}" height="${size}" class="icon ${className}" alt="${name}" />`;
}
