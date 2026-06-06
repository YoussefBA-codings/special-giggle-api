/**
 * Met à jour une commune dans communes-all.final.json :
 *  1. Recalcule ses scores d'investissement avec les thresholds cachés
 *  2. Régénère son entrée dans data/index.json
 *  3. Régénère data/departments/<code>.json
 *  4. Régénère data/regions/<slug>.json
 *
 * Usage : npm run data:update:city -- <inseeCode>
 */
import * as fs from 'fs';
import * as path from 'path';
import { Commune } from '../shared/types/commune.types';
import { Thresholds } from '../shared/types/thresholds.types';
import { CommuneIndex } from '../shared/types/index.types';
import { communeToIndex } from '../modules/data/data-loader.service';
import { recalculateScores } from '../shared/utils/scoring.util';
import { REGION_MAPPING } from '../shared/constants/region-mapping.constant';
import { buildDepartmentSummary, buildRegionSummary } from './shared/aggregators';

const SOURCE_FILE = path.resolve(process.cwd(), 'communes-all.final.json');
const DATA_DIR = path.resolve(process.cwd(), 'data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const THRESHOLDS_FILE = path.join(DATA_DIR, 'thresholds.json');

function writeJson(filePath: string, data: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function main() {
  const inseeCode = process.argv[2];
  if (!inseeCode) {
    console.error('Usage : npm run data:update:city -- <inseeCode>');
    process.exit(1);
  }

  if (!fs.existsSync(THRESHOLDS_FILE)) {
    console.error('❌ data/thresholds.json introuvable — lancez d\'abord npm run data:generate');
    process.exit(1);
  }

  console.log(`🔄 Mise à jour de la commune ${inseeCode}…`);

  const thresholds: Thresholds = JSON.parse(fs.readFileSync(THRESHOLDS_FILE, 'utf-8'));
  const communes: Commune[] = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf-8'));

  const idx = communes.findIndex((c) => c.geo?.inseeCode === inseeCode);
  if (idx === -1) {
    console.error(`❌ Commune ${inseeCode} introuvable dans communes-all.final.json`);
    process.exit(1);
  }

  // Recalculer les scores avec les thresholds cachés
  const commune = communes[idx];
  const newScores = recalculateScores(commune, thresholds);
  communes[idx] = { ...commune, investment: { ...commune.investment, ...newScores } };

  console.log(`   → Scores recalculés (globalScore: ${newScores.globalScore}, yieldScore: ${newScores.yieldScore})`);

  // Sauvegarder communes-all.final.json
  writeJson(SOURCE_FILE, communes);
  console.log('   → communes-all.final.json mis à jour');

  // Mettre à jour l'index
  const indexEntry = communeToIndex(communes[idx]);
  if (fs.existsSync(INDEX_FILE)) {
    const index: CommuneIndex[] = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
    const indexIdx = index.findIndex((c) => c.inseeCode === inseeCode);
    if (indexIdx !== -1 && indexEntry) {
      index[indexIdx] = indexEntry;
    } else if (indexEntry) {
      index.push(indexEntry);
    }
    writeJson(INDEX_FILE, index);
    console.log('   → data/index.json mis à jour');
  }

  // Régénérer le département
  const dept = communes[idx].department;
  const deptCommunes = communes.filter((c) => c.department === dept);
  const fullIndex: CommuneIndex[] = fs.existsSync(INDEX_FILE)
    ? JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'))
    : [];
  const deptIndex = fullIndex.filter((c) => c.department === dept);
  const deptSummary = buildDepartmentSummary(dept, deptCommunes, deptIndex);
  writeJson(path.join(DATA_DIR, 'departments', `${dept}.json`), deptSummary);
  console.log(`   → data/departments/${dept}.json régénéré`);

  // Régénérer la région
  const regionInfo = REGION_MAPPING[dept];
  if (regionInfo) {
    const { slug, name } = regionInfo;
    const regionCommunes = communes.filter((c) => REGION_MAPPING[c.department]?.slug === slug);
    const regionIndex = fullIndex.filter((c) => c.regionSlug === slug);
    const deptCodes = [...new Set(regionCommunes.map((c) => c.department))];
    const regionSummary = buildRegionSummary(slug, name, deptCodes, regionCommunes, regionIndex);
    writeJson(path.join(DATA_DIR, 'regions', `${slug}.json`), regionSummary);
    console.log(`   → data/regions/${slug}.json régénéré`);
  }

  console.log(`\n✅ Commune ${inseeCode} (${communes[idx].city}) mise à jour avec succès`);
  console.log('⚠️  Note : les scores sont recalculés avec les thresholds du dernier data:generate');
  console.log('   Relancez npm run data:generate pour un recalcul complet du dataset');
}

main().catch((err) => {
  console.error('❌ Erreur fatale :', err);
  process.exit(1);
});
