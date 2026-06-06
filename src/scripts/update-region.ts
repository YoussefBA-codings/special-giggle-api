/**
 * Régénère le fichier agrégé d'une région.
 *
 * Usage : npm run data:update:region -- <slug>
 * Ex    : npm run data:update:region -- ile-de-france
 */
import * as fs from 'fs';
import * as path from 'path';
import { Commune } from '../shared/types/commune.types';
import { CommuneIndex } from '../shared/types/index.types';
import { REGION_MAPPING } from '../shared/constants/region-mapping.constant';
import { buildRegionSummary } from './shared/aggregators';

const SOURCE_FILE = path.resolve(process.cwd(), 'communes-all.final.json');
const DATA_DIR = path.resolve(process.cwd(), 'data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

function writeJson(filePath: string, data: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function main() {
  const regionSlug = process.argv[2];
  if (!regionSlug) {
    console.error('Usage : npm run data:update:region -- <slug>');
    console.error('Ex    : npm run data:update:region -- ile-de-france');
    process.exit(1);
  }

  console.log(`🔄 Mise à jour de la région ${regionSlug}…`);

  const communes: Commune[] = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf-8'));
  const regionCommunes = communes.filter((c) => REGION_MAPPING[c.department]?.slug === regionSlug);

  if (regionCommunes.length === 0) {
    console.error(`❌ Aucune commune trouvée pour la région "${regionSlug}"`);
    console.error('Slugs disponibles :', [...new Set(communes.map((c) => REGION_MAPPING[c.department]?.slug).filter(Boolean))].sort().join(', '));
    process.exit(1);
  }

  const index: CommuneIndex[] = fs.existsSync(INDEX_FILE)
    ? JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'))
    : [];

  const regionIndex = index.filter((c) => c.regionSlug === regionSlug);
  const deptCodes = [...new Set(regionCommunes.map((c) => c.department))];
  const regionName = REGION_MAPPING[regionCommunes[0].department]?.name ?? regionSlug;

  const regionSummary = buildRegionSummary(regionSlug, regionName, deptCodes, regionCommunes, regionIndex);
  writeJson(path.join(DATA_DIR, 'regions', `${regionSlug}.json`), regionSummary);

  console.log(`   → data/regions/${regionSlug}.json régénéré (${regionCommunes.length} communes)`);
  console.log(`\n✅ Région "${regionName}" mise à jour`);
}

main().catch((err) => {
  console.error('❌ Erreur fatale :', err);
  process.exit(1);
});
