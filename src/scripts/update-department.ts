/**
 * Régénère les données agrégées d'un département et sa région.
 *
 * Usage : npm run data:update:department -- <code>
 * Ex    : npm run data:update:department -- 92
 */
import * as fs from 'fs';
import * as path from 'path';
import { Commune } from '../shared/types/commune.types';
import { CommuneIndex } from '../shared/types/index.types';
import { REGION_MAPPING } from '../shared/constants/region-mapping.constant';
import { buildDepartmentSummary, buildRegionSummary } from './shared/aggregators';

const SOURCE_FILE = path.resolve(process.cwd(), 'communes-all.final.json');
const DATA_DIR = path.resolve(process.cwd(), 'data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

function writeJson(filePath: string, data: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function main() {
  const deptCode = process.argv[2];
  if (!deptCode) {
    console.error('Usage : npm run data:update:department -- <code>');
    process.exit(1);
  }

  console.log(`🔄 Mise à jour du département ${deptCode}…`);

  const communes: Commune[] = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf-8'));
  const deptCommunes = communes.filter((c) => c.department === deptCode);

  if (deptCommunes.length === 0) {
    console.error(`❌ Aucune commune trouvée pour le département ${deptCode}`);
    process.exit(1);
  }

  const index: CommuneIndex[] = fs.existsSync(INDEX_FILE)
    ? JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'))
    : [];

  const deptIndex = index.filter((c) => c.department === deptCode);
  const deptSummary = buildDepartmentSummary(deptCode, deptCommunes, deptIndex);
  writeJson(path.join(DATA_DIR, 'departments', `${deptCode}.json`), deptSummary);
  console.log(`   → data/departments/${deptCode}.json régénéré (${deptCommunes.length} communes)`);

  const regionInfo = REGION_MAPPING[deptCode];
  if (regionInfo) {
    const { slug, name } = regionInfo;
    const regionCommunes = communes.filter((c) => REGION_MAPPING[c.department]?.slug === slug);
    const regionIndex = index.filter((c) => c.regionSlug === slug);
    const deptCodes = [...new Set(regionCommunes.map((c) => c.department))];
    const regionSummary = buildRegionSummary(slug, name, deptCodes, regionCommunes, regionIndex);
    writeJson(path.join(DATA_DIR, 'regions', `${slug}.json`), regionSummary);
    console.log(`   → data/regions/${slug}.json régénéré`);
  }

  console.log(`\n✅ Département ${deptCode} mis à jour`);
}

main().catch((err) => {
  console.error('❌ Erreur fatale :', err);
  process.exit(1);
});
