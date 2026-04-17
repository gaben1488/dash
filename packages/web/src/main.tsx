import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { bootstrapKBRegistry } from './lib/bootstrap-kb-registry';
import './index.css';

// Populate KBTooltip registry from @aemr/core METRIC_KB before first render.
bootstrapKBRegistry();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
