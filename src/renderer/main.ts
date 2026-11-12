import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/800.css';
import '@fontsource/jetbrains-mono/400.css';
import './styles.css';
import { mount, type Component } from 'svelte';

const view = location.hash.slice(1);
document.documentElement.dataset.view = view;
if (view === 'desk') document.title = 'Agent Desk';

// Each window loads only its own view, so overlay listeners never run in other windows.
const views: Record<string, () => Promise<{ default: Component }>> = {
  pill: () => import('./overlays/Pill.svelte'),
  popup: () => import('./overlays/Popup.svelte'),
  toast: () => import('./overlays/Toast.svelte'),
  desk: () => import('./desk/Desk.svelte'),
};

if (view === 'recorder') {
  void import('./recorder/recorder').then((m) => m.startRecorder());
} else if (views[view]) {
  void views[view]().then((m) => mount(m.default, { target: document.getElementById('app')! }));
}
