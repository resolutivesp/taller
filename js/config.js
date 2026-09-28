// Taller — configuration. Edit these values before/after deploying.
export const CONFIG = {
  version: '0.7-beta',

  // Where in-app feedback is sent (mailto). Change to your address.
  feedbackEmail: 'resolutivesp@gmail.com',

  // Optional: URL of the AI answer service (Cloudflare Worker, see /worker).
  // Leave '' to disable online AI — the app still works fully offline
  // (search + best-matching pages + "copy prompt" for any external AI).
aiEndpoint: 'https://taller-ai.resolutivesp.workers.dev',
repoUrl: 'https://github.com/resolutivesp/taller',

  // Import guard: warn before importing PDFs bigger than this (MB).
  // Kept modest — a big scanned manual can exhaust RAM on a 2 GB phone.
  bigFileWarnMB: 35,
};

// Equipment types common in an African district hospital (grounded in the
// Malawi National Medical Equipment Baseline 2022 + standard district set).
// risk: high = life-support/high-hazard (WHO Fennigkoh-Smith). pm = default
// preventive-maintenance interval in days (editable per device; WHO defers exact
// frequency to the manufacturer's manual — these are risk-tier defaults).
export const EQUIPMENT_TYPES = [
  { key: 'oxygen_concentrator', risk: 'high', pm: 90 },
  { key: 'ventilator', risk: 'high', pm: 90 },
  { key: 'anaesthesia', risk: 'high', pm: 90 },
  { key: 'patient_monitor', risk: 'high', pm: 180 },
  { key: 'defibrillator', risk: 'high', pm: 180 },
  { key: 'infant_incubator', risk: 'high', pm: 180 },
  { key: 'infant_warmer', risk: 'high', pm: 180 },
  { key: 'cpap', risk: 'high', pm: 180 },
  { key: 'infusion_pump', risk: 'high', pm: 180 },
  { key: 'syringe_pump', risk: 'high', pm: 180 },
  { key: 'electrosurgical', risk: 'high', pm: 180 },
  { key: 'suction_pump', risk: 'medium', pm: 180 },
  { key: 'phototherapy', risk: 'medium', pm: 365 },
  { key: 'ecg', risk: 'medium', pm: 365 },
  { key: 'ultrasound', risk: 'medium', pm: 365 },
  { key: 'xray', risk: 'medium', pm: 365 },
  { key: 'autoclave', risk: 'medium', pm: 180 },
  { key: 'vaccine_fridge', risk: 'medium', pm: 180 },
  { key: 'pulse_oximeter', risk: 'medium', pm: 365 },
  { key: 'nebulizer', risk: 'low', pm: 365 },
  { key: 'centrifuge', risk: 'low', pm: 365 },
  { key: 'microscope', risk: 'low', pm: 365 },
  { key: 'bp_monitor', risk: 'low', pm: 365 },
  { key: 'fetal_doppler', risk: 'low', pm: 365 },
  { key: 'exam_light', risk: 'low', pm: 365 },
  { key: 'weighing_scale', risk: 'low', pm: 365 },
  { key: 'glucometer', risk: 'low', pm: 365 },
  { key: 'dental_unit', risk: 'low', pm: 365 },
  { key: 'other', risk: 'medium', pm: 365 },
];

// Equipment status (WHO CMMS status flags, simplified for a lone BMET).
export const EQUIPMENT_STATUS = ['working', 'down', 'awaiting_parts', 'retired'];

// Quick PM interval presets (days). 0 = no scheduled PM.
export const PM_PRESETS = [30, 90, 180, 365, 0];

// "Due soon" window for preventive maintenance (days before due date).
export const PM_SOON_DAYS = 14;

// Demo seed: a fully-populated equipment record linked to the demo manual,
// so "Try the demo" instantly shows the whole product working. daysAgo values
// are turned into real dates at seed time (keeps this file static-friendly).
export const DEMO_EQUIPMENT = {
  type: 'suction_pump',
  manufacturer: 'OpenMed Instruments',
  model: 'SP-100',
  serial: 'SP100-2419-0387',
  assetTag: 'BME-014',
  location: { en: 'Maternity ward', fr: 'Maternité', es: 'Maternidad', pt: 'Maternidade' },
  status: 'working',
  power: '220 V',
  pmDays: 180,
  acquiredDaysAgo: 540,
  lastPmDaysAgo: 200, // → overdue, so the PM alert shows on Home
  logs: [
    { daysAgo: 200, type: 'pm', status: 'fixed', minutes: 20,
      problem: { en: 'Scheduled PM: cleaned filter, tested vacuum −78 kPa. OK.', fr: 'MP planifiée : filtre nettoyé, vide testé −78 kPa. OK.', es: 'MP programado: filtro limpiado, vacío probado −78 kPa. OK.', pt: 'MP planeada: filtro limpo, vácuo testado −78 kPa. OK.' } },
    { daysAgo: 32, type: 'repair', status: 'fixed', minutes: 35,
      problem: { en: 'Error E3, weak suction. Replaced diaphragms (kit PK-110), retested.', fr: 'Erreur E3, aspiration faible. Membranes remplacées (kit PK-110), retesté.', es: 'Error E3, aspiración débil. Membranas sustituidas (kit PK-110), reensayado.', pt: 'Erro E3, aspiração fraca. Membranas substituídas (kit PK-110), retestado.' } },
  ],
};

// Guided first-experience: suggested searches/questions matching the demo manual.
// Keyed by the demo manual's language (not the UI language).
export const DEMO_SUGGESTIONS = {
  en: {
    search: ['no suction', 'error E4', 'fuse', 'maintenance schedule'],
    ask: ['The pump shows E4 and stops', 'No suction but the motor runs', 'Runs on mains but not on battery'],
  },
  fr: {
    search: ['pas d’aspiration', 'erreur E4', 'fusible', 'maintenance préventive'],
    ask: ['L’aspirateur affiche E4 puis s’arrête', 'Pas d’aspiration mais le moteur tourne', 'Fonctionne sur secteur mais pas sur batterie'],
  },
  es: {
    search: ['sin aspiración', 'error E4', 'fusible', 'mantenimiento preventivo'],
    ask: ['La bomba se detiene y muestra el error E4', 'No hay aspiración pero el motor gira', 'Funciona con red eléctrica pero no con batería'],
  },
  // pt: "fusíveis" (plural) rather than "fusível" — Portuguese pluralises
  // -l → -is, so the singular is neither a prefix nor a fuzzy match of the
  // plural that the manual mostly uses, and the singular chip scored weak.
  pt: {
    search: ['sem aspiração', 'erro E4', 'fusíveis', 'manutenção preventiva'],
    ask: ['O aspirador mostra E4 e desliga-se', 'Não há aspiração mas o motor trabalha', 'Funciona na rede mas não na bateria'],
  },
};
