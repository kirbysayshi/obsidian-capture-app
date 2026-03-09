export interface Prop {
  k: string;
  v: string;
  type?: 'text' | 'boolean';
}

export interface Config {
  vault: string;
  folder: string;
  canvas: boolean;
  props: Prop[];
  /** Custom name for the bookmarklet link and iOS home screen shortcut */
  name: string;
  /** Emoji character used as the iOS home screen icon */
  emoji: string;
}

function utf8ToBase64(str: string): string {
  return btoa(
    Array.from(new TextEncoder().encode(str))
      .map(b => String.fromCharCode(b))
      .join('')
  );
}

function base64ToUtf8(b64: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  );
}

/**
 * Encode a Config object into URL search params.
 */
export function encodeConfig(config: Config): URLSearchParams {
  const params = new URLSearchParams();
  if (config.vault) params.set('v', config.vault);
  if (config.folder) params.set('f', config.folder);
  if (config.canvas) params.set('canvas', '1');
  if (config.name) params.set('n', config.name);
  if (config.emoji) params.set('e', config.emoji);
  if (config.props.length > 0) {
    params.set('props', btoa(JSON.stringify(config.props)));
  }
  return params;
}

interface EncodedInstance {
  vault: string;
  folder?: string;
  name?: string;
  emoji?: string;
  canvas?: boolean;
  props?: Prop[];
}

export function encodeInstances(configs: Config[]): URLSearchParams {
  const params = new URLSearchParams();
  const data: EncodedInstance[] = configs.map(cfg => {
    const entry: EncodedInstance = { vault: cfg.vault };
    if (cfg.folder) entry.folder = cfg.folder;
    if (cfg.name) entry.name = cfg.name;
    if (cfg.emoji) entry.emoji = cfg.emoji;
    if (cfg.canvas) entry.canvas = true;
    if (cfg.props.length > 0) entry.props = cfg.props;
    return entry;
  });
  params.set('instances', utf8ToBase64(JSON.stringify(data)));
  return params;
}

export function decodeInstances(params: URLSearchParams): Config[] | null {
  const raw = params.get('instances');
  if (!raw) return null;
  try {
    const data = JSON.parse(base64ToUtf8(raw)) as EncodedInstance[];
    return data.map(entry => ({
      vault: entry.vault ?? '',
      folder: entry.folder ?? '',
      name: entry.name ?? '',
      emoji: entry.emoji ?? '',
      canvas: entry.canvas ?? false,
      props: entry.props ?? [],
    }));
  } catch {
    return null;
  }
}

/** Decode global scraper config from URL params (su + ss).
 *  Falls back to build-time env default for the URL. */
export function decodeScraperConfig(params: URLSearchParams): { serviceUrl: string; secret: string } {
  return {
    serviceUrl: params.get('su') ?? import.meta.env.VITE_SCRAPER_URL ?? '',
    secret: params.get('ss') ?? import.meta.env.VITE_SCRAPER_SECRET ?? '',
  };
}

/**
 * Decode a Config from URL search params.
 */
export function decodeConfig(params: URLSearchParams): Config {
  const vault = params.get('v') ?? '';
  const folder = params.get('f') ?? '';
  const canvas = params.get('canvas') === '1';
  const name = params.get('n') ?? '';
  const emoji = params.get('e') ?? '';
  let props: Prop[] = [];
  const propsRaw = params.get('props');
  if (propsRaw) {
    try {
      props = JSON.parse(atob(propsRaw)) as Prop[];
    } catch {
      props = [];
    }
  }
  return { vault, folder, canvas, name, emoji, props };
}
