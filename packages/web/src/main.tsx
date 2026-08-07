import React from 'react';
import ReactDOM from 'react-dom/client';
// Шрифты самохостом, а не с внешнего CDN. Инструмент живёт за периметром
// без интернета: любая внешняя загрузка шрифта там молча падает на системный
// фолбэк, а вместе с ним рассыпается вся числовая типографика — табличные
// цифры, ширина разрядов, выравнивание сумм в столбик.
import '@fontsource-variable/inter';
import '@fontsource-variable/geist-mono';
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
