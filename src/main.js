import { SketchpadEngine } from './audio/engine.js';
import { mountApp } from './ui/app.js';

const engine = new SketchpadEngine();
const root = document.getElementById('app');
mountApp(root, engine);

window.__mrzesty = engine;
