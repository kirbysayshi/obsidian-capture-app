import { execSync } from 'child_process';

const gitHash = execSync('git rev-parse --short HEAD').toString().trim();

/** Emits public/version.json into the build output. */
function versionPlugin() {
  return {
    name: 'version',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: gitHash }),
      });
    },
  };
}

export default {
  base: './', // relative paths — works for GH Pages subpath deployment
  plugins: [versionPlugin()],
  define: {
    // Injected at build time; compared against version.json at runtime
    __APP_VERSION__: JSON.stringify(gitHash),
  },
}
