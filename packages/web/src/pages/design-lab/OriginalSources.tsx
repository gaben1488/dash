/**
 * Actual historical HTML specimens: no repainting or invented replacement geometry.
 * Each artifact is loaded only on demand into a sandboxed, opaque-origin iframe.
 * Inert sources remain sources; nobody should treat their fake data as today's facts.
 */
import { useEffect, useState } from 'react';
import { ExternalLink, Eye, RefreshCw, ShieldAlert } from 'lucide-react';

interface Source {
  id: string;
  name: string;
  file: string;
  role: string;
  limitation: string;
  load: () => Promise<{ default: string }>;
}

export const ORIGINAL_SOURCES: readonly Source[] = [
  { id: 'pulse', name: 'Пульс: барабаны, щит, оболочка', file: 'pulse.html',
    role: 'Общая геометрия навигации, щита, барабанов и многомерного экрана',
    limitation: 'Предметные расчёты и вымышленные данные Пульса не переносить',
    load: () => import('../../../../../docs/superpowers/mockups/pulse.html?raw') },
  { id: 'zarya', name: 'Заря: космос, Камчатка, минералы', file: 'zarya-vystavka.html',
    role: 'Три исходных тематических семейства, 39 пар цветов, живая заря',
    limitation: 'Выставка вариантов не является выбором владельца',
    load: () => import('../../../../../docs/superpowers/mockups/zarya-vystavka.html?raw') },
  { id: 'finish', name: 'Отделки: автомобильные материалы', file: 'otdelki.html',
    role: 'Проверка шести оригинальных физических эффектов в исходном оформлении',
    limitation: 'Материал выбирается по назначению, не покрывает строки реестра',
    load: () => import('../../../../../docs/superpowers/mockups/otdelki.html?raw') },
  { id: 'corner', name: 'Угол: три варианта', file: 'ugol-varianty.html',
    role: 'Сравнение решётки, прибора, жетонов и раскрываемых условий',
    limitation: 'Пометка автора «рекомендую» не означает согласия владельца',
    load: () => import('../../../../../docs/superpowers/mockups/ugol-varianty.html?raw') },
  { id: 'corner-large', name: 'Угол: крупная геометрия', file: 'ugol-otbora-krupno.html',
    role: 'Размеры, оси и варианты открытого прибора',
    limitation: 'Увеличенный образец — не масштабы и контракты рабочего Dash',
    load: () => import('../../../../../docs/superpowers/mockups/ugol-otbora-krupno.html?raw') },
  { id: 'corner-strip', name: 'Угол в линейке', file: 'ugol-v-linejke-demo.html',
    role: 'Проверка прибора в настоящем окружении полосы',
    limitation: 'Демо-счётчики и вебхуки не являются серверным состоянием',
    load: () => import('../../../../../docs/superpowers/mockups/ugol-v-linejke-demo.html?raw') },
  { id: 'archeology', name: 'Заря: история оформления', file: 'zarya-arheologiya.html',
    role: 'Преемственность, внутренний градиент и ранняя эпоха оформления',
    limitation: 'Архивная реконструкция не отменяет позднейших поправок',
    load: () => import('../../../../../docs/superpowers/mockups/zarya-arheologiya.html?raw') },
] as const;

export type OriginalSourceId = (typeof ORIGINAL_SOURCES)[number]['id'];
const sourceRoot = 'https://github.com/gaben1488/dash/blob/main/docs/superpowers/mockups/';

/**
 * Prevent scripts in historical prototypes from reaching live endpoints or the parent.
 * Inline code/CSS/data SVG still render; network, forms, frames and popups are blocked.
 * This purposely differs from opening the original standalone file without a sandbox.
 */
export function sandboxOriginal(html: string): string {
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; connect-src \'none\'; form-action \'none\'; frame-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; img-src data: blob:; font-src data:;">';
  const whole = /^\s*(?:<!doctype[^>]*>\s*)?<html\b/i.test(html);
  if (!whole) return '<!doctype html><html lang="ru"><head><meta charset="utf-8">' + csp + '</head><body>' + html + '</body></html>';
  if (!/<head\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, '$&<head>' + csp + '</head>');
  return html.replace(/<head\b[^>]*>/i, '$&' + csp);
}

export function OriginalSources() {
  const [selected, setSelected] = useState<OriginalSourceId>('finish');
  const [width, setWidth] = useState<390 | 768 | 1280>(1280);
  const [html, setHtml] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reload, setReload] = useState(0);
  const source = ORIGINAL_SOURCES.find((item) => item.id === selected)!;

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setHtml('');
    source.load().then((module) => {
      if (cancelled) return;
      setHtml(sandboxOriginal(module.default));
      setStatus('ready');
    }).catch(() => {
      if (!cancelled) setStatus('error');
    });
    return () => { cancelled = true; };
  }, [source, reload]);

  return (
    <div className="dl-originals">
      <div className="dl-panel-intro">
        <div>
          <h2>Исходные макеты — без перерисовки</h2>
          <p>Это оригинальные HTML-файлы репозитория. Для проверки геометрии и материалов, не для замены рабочих страниц.</p>
        </div>
        <span className="dl-origin-label">Архивный оригинал ≠ утверждённый вариант</span>
      </div>
      <div className="dl-original-toolbar">
        <label>Какой оригинал
          <select aria-label="Оригинальный макет" value={selected} onChange={(e) => setSelected(e.target.value as OriginalSourceId)}>
            {ORIGINAL_SOURCES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <fieldset>
          <legend>Ширина окна макета</legend>
          {([390,768,1280] as const).map(value => (
            <button key={value} type="button" aria-pressed={width === value} onClick={() => setWidth(value)}>
              {value} px
            </button>
          ))}
        </fieldset>
        <button type="button" className="dl-original-refresh" onClick={() => setReload(v => v + 1)}>
          <RefreshCw size={15} aria-hidden="true" /> Перезапустить оригинал
        </button>
      </div>
      <div className="dl-original-context">
        <div><strong>Что здесь сохранять</strong><p>{source.role}</p></div>
        <div><strong>Что не считать готовым</strong><p>{source.limitation}</p></div>
        <a href={sourceRoot + source.file} rel="noopener noreferrer" target="_blank">
          Открыть исходный файл <ExternalLink size={13} aria-hidden="true" />
        </a>
      </div>
      <div className="dl-original-notice">
        <ShieldAlert size={17} aria-hidden="true" />
        <p>Сценарии выполняются внутри защищённого окна без доступа к рабочему API, формам и родительскому приложению. Внешние ресурсы блокируются. Это сохраняет исходный HTML, но может отключать внешние ссылки и шрифты.</p>
      </div>
      <div className="dl-original-viewport" aria-label="Просмотр исходного макета">
        {status === 'loading' && <div role="status" className="dl-original-message">Загружается исходный HTML…</div>}
        {status === 'error' && <div role="alert" className="dl-original-message">
          Исходник не удалось загрузить. <button type="button" onClick={() => setReload(v => v + 1)}>Повторить</button>
        </div>}
        {status === 'ready' && <iframe
          key={selected + ':' + reload}
          title={'Архивный оригинал: ' + source.name}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={html}
          width={width}
          height={750}
          loading="lazy"
        />}
      </div>
      <p className="dl-original-foot"><Eye size={14} aria-hidden="true" /> Страница прокручивается внутри окна. Сравнение с действующим Dash и дизайн-приёмка остаются отдельными действиями.</p>
    </div>
  );
}
