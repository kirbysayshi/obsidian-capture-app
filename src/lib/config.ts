export interface Prop {
  k: string;
  v: string;
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
