import './style.css';
import { renderConfigure } from './views/configure.js';
import { renderUse } from './views/use.js';

const params = new URLSearchParams(window.location.search);
const app = document.getElementById('app')!;

if (params.get('v')) {
  renderUse(app, params);
} else {
  renderConfigure(app);
}
