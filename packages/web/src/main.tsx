import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
// Шрифты самохостом, а не с внешнего CDN. Инструмент живёт за периметром
// без интернета: любая внешняя загрузка шрифта там молча падает на системный
// фолбэк, а вместе с ним рассыпается вся числовая типографика — табличные
// цифры, ширина разрядов, выравнивание сумм в столбик.
import '@fontsource-variable/inter';
import '@fontsource-variable/geist-mono';
import { App } from './App';
import { Toaster } from './components/ui/toast';
import { bootstrapKBRegistry } from './lib/bootstrap-kb-registry';
import './index.css';

// Populate KBTooltip registry from @aemr/core METRIC_KB before first render.
bootstrapKBRegistry();

// ── Витрина облика (только разработка).
//
//    Открывается по адресу `#/kit` и заменяет собой приложение целиком:
//    смотреть примитивы удобнее без шапки, полосы навигации и загрузки
//    снимка. В собранный продукт витрина не попадает — `import.meta.env.DEV`
//    сборщик подменяет на `false`, а мёртвую ветку выбрасывает вместе с
//    ленивым запросом файла, поэтому куска витрины в `dist` нет вовсе.
//
//    Витрина намеренно НЕ заведена страницей в `store.ts`: она не часть
//    продукта и не должна появляться ни в полосе навигации, ни в истории
//    переходов.
const KitPage = import.meta.env.DEV
  ? lazy(() => import('./pages/Kit').then((m) => ({ default: m.KitPage })))
  : null;

// Два входа намеренно: `#/kit` удобно набрать руками, `?kit` переживает
// программный переход (часть средств автоматизации отбрасывает часть
// адреса после решётки при первом заходе, и витрина тогда не открывается).
const showKit =
  import.meta.env.DEV &&
  (window.location.hash.startsWith('#/kit') || window.location.search.includes('kit'));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {showKit && KitPage ? (
      <Suspense fallback={null}>
        <KitPage />
      </Suspense>
    ) : (
      <App />
    )}
    {/* Стопка уведомлений живёт рядом с приложением, а не внутри него:
        она обязана пережить смену раздела, иначе сообщение об отказе
        исчезнет вместе с той страницей, на которой отказ и случился. */}
    <Toaster />
  </React.StrictMode>,
);
