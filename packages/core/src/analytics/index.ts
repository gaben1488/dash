export { buildGRBSProfiles, GRBS_BASELINES, BASELINE_UNCONFIRMED_NOTE, type GRBSProfile, type GRBSBaseline, type GRBSRole } from './grbs-profile.js';
export { checkEPContractLimits, checkAntiDumping, checkEPShareLimits, analyzeEPReasons, classifyEPReason, LAW_44FZ, EP_SHARE_BY_ROLE, type ComplianceIssue, type EPReasonBreakdown, type EPReasonCode } from './compliance-44fz.js';
export { detectAntiCorruption, detectSplitting, detectZeroCompetition, detectPriceInflation, detectEpOverLimit, detectAnnualEpShare, detectSupplierConcentration, penaltyForSeverity, type AntiCorruptionRow, type AntiCorruptionFlag, type AntiCorruptionResult, type AntiCorruptionInput, type AntiCorruptionIndicator, type FlagSeverity } from './anticorruption.js';
export { gradeGRBS, phaseAdjustedTarget, type Grade, type GrbsGradeInput, type GrbsGradeResult } from './grbs-grade.js';
export { disciplineIndex, DISCIPLINE_WEIGHTS, type DisciplineInput, type DisciplineResult, type NarrativeMode, type DominantFactor } from './discipline-index.js';
export { benfordAnalysis, ewmaDetection, zScoreAnalysis, type BenfordResult, type EWMAResult, type ZScoreResult } from './anomaly.js';
export { linearForecast, seasonalForecast, buildScenarios, type ForecastScenario, type ForecastResult } from './forecast.js';
export { classifySubject, buildSubjectAnalysis, type SubjectCategory, type SubjectAnalysisReport } from './subject-classify.js';
export {
  matchSubjectFuzzy,
  fuzzyIncludes,
  normalizeRu,
  stemRu,
  editDistance,
  type FuzzySubjectMatch,
  type FuzzyMatchKind,
} from './subject-fuzzy.js';
export {
  findCentralizationOpportunities,
  type CentralizationOpportunity,
  type CentralizationMember,
  type CentralizationOptions,
} from './centralization.js';
// Нагрузка управлений (канон п.103) и три рода событий над строкой (п.105).
// До 18.08.2026 модули считались, но наружу не выходили — их не было в барреле,
// и ни сервер, ни экран не могли их позвать (маяк, §4, строки Г-02…Г-04).
export {
  deptWorkload,
  workloadReport,
  type DeptWorkloadInput,
  type DeptWorkload,
  type JournalObservability,
  type WorkloadReport,
} from './workload.js';
export {
  classifyJournalEvents,
  sheetRowOfCell,
  type JournalEntry,
  type RowEvent,
  type RowEventKind,
  type JournalEventSummary,
} from './journal-events.js';
export {
  diffSnapshots,
  type SnapshotRow,
  type VanishedRow,
  type MovedRow,
  type RowDiff,
} from './vanished-rows.js';
// Разбор ЕП по степеням обоснованности и динамика его сокращения (канон п.98ж).
export {
  buildEpJustificationDept,
  mergeEpGradeBuckets,
  mergeEpClusters,
  emptyEpGradeBucket,
  summarizeEpGrades,
  epQuarterDynamics,
  topClustersOfGrade,
  epClusterLabel,
  epPlanQuarter,
  EP_QUARTER_KEYS,
  type EpJustificationRow,
  type EpJustificationDept,
  type EpGradeBucket,
  type EpCell,
  type EpQuarterKey,
  type EpGradeSlice,
  type EpJustificationSummary,
  type EpQuarterPoint,
  type EpClusterSlice,
} from './ep-justification.js';
// Детектор подозрительных закупок: две независимые шкалы («похоже на опечатку»
// и «похоже на подгон»), список признаков с адресом и суммой под риском.
//
// ВТОРОЕ ИМЯ — НЕ УКРАШЕНИЕ. В барреле пакета (core/index.ts) имя
// `detectAnomalies` уже занято детектором вкладки «Мониторинг»
// (monitoring/analytics.ts), и явный именованный экспорт по правилам модулей
// побеждает звёздный: `import { detectAnomalies } from '@aemr/core'` молча
// отдаёт ЧУЖУЮ функцию с другой сигнатурой. Пока имена не разведены в самих
// модулях, наружу этот детектор ходит под однозначным именем — иначе
// потребитель получает не тот механизм, и компилятор об этом не скажет.
export { detectAnomalies as detectRowAnomalies } from './anomaly-detection.js';
export {
  detectAnomalies,
  detectMagnitudeOutliers,
  detectRoundAmongFractional,
  detectYearOffByOne,
  detectDecimalShift,
  detectRepeatOfNeighbour,
  detectThousandfoldEdits,
  detectBenfordDeviation,
  detectThresholdHugging,
  detectSplittingWindow,
  detectFactEqualsPlan,
  detectRetroEdits,
  detectZeroEconomyMass,
  median,
  hasKopecks,
  hasFractionalThousands,
  isRoundAmount,
  powerOfTen,
  digitSignature,
  normalizeSubject,
  columnOfCell,
  sheetRowOfCell as anomalySheetRowOfCell,
  editMoment,
  formatMoment,
  journalNumber,
  subordinateKey,
  indexRowsByAddress,
  ANOMALY_LIMITS,
  type AnomalyRow,
  type AnomalyJournalEntry,
  type AnomalyFinding,
  type AnomalyReport,
  type AnomalyInput,
  type AnomalyAddress,
  type AnomalyScale,
  type AnomalySign,
} from './anomaly-detection.js';
