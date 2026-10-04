import { REPORT_SCHEMA, PAIRED_FIELDS, COVERAGE_FIELDS } from '../automation/openai.mjs';
import { hash } from '../automation/core.mjs';

export function fixtureSource(overrides = {}) {
  return { id: 'source-1', kind: 'web', title: 'Synthetic harbour closure', source_url: 'https://example.org/Harbour?id=1',
    published_at: '2026-10-04T04:00:00.000Z', event_at: '2026-10-04T04:00:00.000Z', imported_at: '2026-10-04T06:00:00.000Z',
    language: 'en', topics: ['safety'], body: 'Synthetic test evidence: harbour temporarily closed after a reported incident.', status: 'verified', ...overrides };
}
export function fixtureReport(profile, window, sources = []) {
  const items = sources.map((source, index) => {
    const item = Object.fromEntries(Object.keys(REPORT_SCHEMA.properties.items.items.properties).map(k => [k, '']));
    for (const base of PAIRED_FIELDS) {
      item[base + '_de'] = 'Kein belastbarer besonderer Bezug belegt; Originalquelle prüfen.';
      item[base + '_en'] = 'No substantiated special linkage identified; verify the original source.';
    }
    Object.assign(item, { date: source.event_at.slice(0, 10), event_at: source.event_at, event_key: 'case-' + source.id, time_window_status: 'IN_SCOPE', category: 'safety', severity: 'mittel',
      headline_de: 'Synthetischer Hafenfall ' + index, headline_en: 'Synthetic harbour case ' + index, sources: [source.source_url], source_ids: [source.id],
      summary_de: 'Synthetischer Testfall: Hafen nach einem gemeldeten Vorfall vorübergehend geschlossen.', summary_en: 'Synthetic test case: harbour temporarily closed after a reported incident.',
      assessment_de: 'Die Quelle meldet eine vorübergehende Hafenschließung. Ursachen und operative Folgen müssen bestätigt werden.', assessment_en: 'The source reports a temporary harbour closure. The cause and operational consequences require confirmation.',
      region_de: 'Nordsee', region_en: 'North Sea', corridor_de: 'Deutsche Bucht', corridor_en: 'German Bight',
      category_de: 'Störung der Schifffahrt / Safety', category_en: 'Shipping Disruption / Safety', subcategory_de: 'Hafenschließung', subcategory_en: 'Harbour closure',
      evidence_de: 'C2 · Synthetische Testquelle, ungeprüft', evidence_en: 'C2 · Synthetic test source, unverified', actor_type_de: 'Hafenbehörde', actor_type_en: 'Harbour authority',
      prueffelder_de: ['Status bei Hafenbehörde prüfen.'], prueffelder_en: ['Check status with harbour authority.'],
      places: [{ name: 'Hamburg', lat: 53.54, lon: 9.98, type: 'port', precision: 'approximate', role: 'event_location', geo_source: 'source', locode: 'DEHAM' }], port: 'Hamburg', country: 'Germany' });
    return item;
  });
  return { meta: { report_date: window.report_date, period: window.label, language_mode: 'bilingual_de_en', output_contract: 'json_only', source_count: sources.length, item_count: items.length,
    report_summary_de: ('Synthetischer Testbericht: Der bestätigte Sachstand beschränkt sich auf die hier genannten Originalquellen. Behauptungen, offene Fragen und operative Auswirkungen bleiben getrennt. Keine neue staatliche Zuschreibung wird vorgenommen. ' ).repeat(3),
    report_summary_en: ('Synthetic test report: The confirmed situation is limited to the original sources cited here. Allegations, open questions and operational consequences remain distinct. No new attribution to a state actor is made. ').repeat(3),
    priority_findings_de: ['Hafenstatus prüfen.', 'Datumsgrenzen beachten.', 'Originalquelle bestätigen.'], priority_findings_en: ['Check harbour status.', 'Respect date limits.', 'Confirm original source.'],
    search_coverage: { ...Object.fromEntries(COVERAGE_FIELDS.map(k => [k, k === 'web_research_enabled'])), negative_findings_de: [], negative_findings_en: [], notes_de: 'Synthetische Testrecherche.', notes_en: 'Synthetic test research.' } },
    items, discarded: { OUT_OF_SCOPE: [], DUPLIKAT: [], IRRELEVANT: [] } };
}
export function fixtureArtifacts(profile) {
  const pdf = Buffer.from('%PDF-1.7\n' + 'synthetic'.repeat(150));
  return Object.fromEntries((profile.language === 'both' ? ['de', 'en'] : [profile.language]).map(language => [language, { language, filename: 'synthetic_' + language,
    html: '<html lang="' + language + '"><body>Synthetic report</body></html>', markdown: '# Synthetic report', text: 'Synthetic report', pdf_base64: pdf.toString('base64'), pdf_hash: hash(pdf) }]));
}
