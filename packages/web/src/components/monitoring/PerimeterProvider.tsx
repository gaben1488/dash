/**
 * Паспорт периметра, розданный вкладке «Мониторинг» сверху.
 *
 * ПОЧЕМУ КОНТЕКСТ, А НЕ ПРОП. Периметр числа складывается из двух вещей: из
 * состояния ШАПКИ (одно на всю вкладку) и из ОБЛАСТИ самого числа — срезано ли
 * оно выбранным управлением. Первое знает страница, второе — сам блок. Гнать
 * состояние шапки пропом через девять блоков аналитики значило бы завести
 * девять мест, где его можно забыть передать; забытый периметр — это молчащая
 * ось, ровно тот дефект, ради которого паспорт и появился (канон п.58).
 * Поэтому шапку раздаёт контекст, а область каждый блок называет за себя.
 *
 * ВЛОЖЕННЫЙ ПРОВАЙДЕР — ЭТО НЕ ХИТРОСТЬ, А ЧЕСТНОСТЬ. Реестр и аналитика
 * приезжают РАЗНЫМИ запросами и, значит, разными моментами чтения книги.
 * Секция аналитики ставит свой провайдер со своим `readAt`: подписать её числа
 * моментом реестра означало бы соврать про свежесть (канон п.64г — обе стороны
 * сверки обязаны быть из одного момента, и момент поэтому полноправная ось).
 *
 * ОТСУТСТВИЕ ПРОВАЙДЕРА — НЕ ОШИБКА. Блок, вынутый в тест или в витрину без
 * страницы, паспорта не покажет и не упадёт: `null` здесь значит «периметр не
 * заявлен», а не «периметр пустой». Выдуманного паспорта не бывает.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { Perimeter } from '../../lib/perimeter';
import {
  useMonitoringPerimeters,
  type MonitoringScopeKind,
} from '../../lib/monitoring/perimeter';
import { PerimeterCaption } from '../FigureView';

interface MonitoringPerimeters {
  readonly registry: Perimeter;
  readonly district: Perimeter;
}

const MonitoringPerimeterContext = createContext<MonitoringPerimeters | null>(null);

export function MonitoringPerimeterProvider({
  readAt, children,
}: { readAt: string | null; children: ReactNode }) {
  const value = useMonitoringPerimeters(readAt);
  return (
    <MonitoringPerimeterContext.Provider value={value}>
      {children}
    </MonitoringPerimeterContext.Provider>
  );
}

/**
 * Периметр числа этой области. `null` — страница периметр не раздавала
 * (блок вынут из вкладки), и подпись обязана отсутствовать, а не сочиниться.
 */
export function useMonitoringScopePerimeter(scope: MonitoringScopeKind): Perimeter | null {
  const value = useContext(MonitoringPerimeterContext);
  if (value === null) return null;
  return scope === 'registry' ? value.registry : value.district;
}

/**
 * Готовая подпись паспорта под числом блока — единственный способ напечатать
 * периметр в зоне мониторинга. Без провайдера не печатает ничего.
 */
export function MonitoringPerimeterCaption({
  scope, className,
}: { scope: MonitoringScopeKind; className?: string }) {
  const perimeter = useMonitoringScopePerimeter(scope);
  if (perimeter === null) return null;
  return <PerimeterCaption perimeter={perimeter} {...(className !== undefined ? { className } : {})} />;
}
