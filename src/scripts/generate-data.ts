import * as fs from 'fs';
import * as path from 'path';
import { Commune } from '../shared/types/commune.types';
import { communeToIndex } from '../modules/data/data-loader.service';
import { REGION_MAPPING } from '../shared/constants/region-mapping.constant';
import { calculateThresholds } from './shared/thresholds-calculator';
import { buildDepartmentSummary, buildRegionSummary } from './shared/aggregators';

const SOURCE_FILE = path.resolve(process.cwd(), 'communes-all.final.json');
const DATA_DIR = path.resolve(process.cwd(), 'data');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath: string, data: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function main() {
  console.log('🏗  Démarrage de la génération des données…');

  if (!fs.existsSync(SOURCE_FILE)) {
    console.error(`❌ Fichier source introuvable : ${SOURCE_FILE}`);
    process.exit(1);
  }

  console.log('📖 Lecture de communes-all.final.json…');
  const raw = fs.readFileSync(SOURCE_FILE, 'utf-8');
  const communes: Commune[] = JSON.parse(raw);
  console.log(`   → ${communes.length} communes chargées`);

  ensureDir(DATA_DIR);
  ensureDir(path.join(DATA_DIR, 'departments'));
  ensureDir(path.join(DATA_DIR, 'regions'));

  // 1. Thresholds
  console.log('📊 Calcul des thresholds de percentile…');
  const thresholds = calculateThresholds(communes);
  writeJson(path.join(DATA_DIR, 'thresholds.json'), thresholds);
  console.log('   → data/thresholds.json écrit');

  // 2. Index léger
  console.log('📋 Génération de l\'index léger…');
  const index = communes.map(communeToIndex).filter(Boolean);
  writeJson(path.join(DATA_DIR, 'index.json'), index);
  console.log(`   → data/index.json écrit (${index.length} entrées)`);

  // 3. Regrouper par département
  const byDept = new Map<string, Commune[]>();
  const indexByDept = new Map<string, typeof index>();
  for (const commune of communes) {
    const dept = commune.department;
    if (!byDept.has(dept)) { byDept.set(dept, []); indexByDept.set(dept, []); }
    byDept.get(dept)!.push(commune);
  }
  for (const entry of index) {
    if (!entry) continue;
    if (!indexByDept.has(entry.department)) indexByDept.set(entry.department, []);
    indexByDept.get(entry.department)!.push(entry);
  }

  // 4. Fichiers département
  console.log(`🏙  Génération de ${byDept.size} fichiers département…`);
  for (const [code, deptCommunes] of byDept) {
    const deptIndex = indexByDept.get(code) ?? [];
    const summary = buildDepartmentSummary(code, deptCommunes, deptIndex as any);
    writeJson(path.join(DATA_DIR, 'departments', `${code}.json`), summary);
  }
  console.log(`   → data/departments/ (${byDept.size} fichiers)`);

  // 5. Regrouper par région
  const byRegion = new Map<string, { communes: Commune[]; index: typeof index }>();
  for (const commune of communes) {
    const regionInfo = REGION_MAPPING[commune.department];
    if (!regionInfo) continue;
    const { slug } = regionInfo;
    if (!byRegion.has(slug)) byRegion.set(slug, { communes: [], index: [] });
    byRegion.get(slug)!.communes.push(commune);
  }
  for (const entry of index) {
    if (!entry) continue;
    if (!byRegion.has(entry.regionSlug)) continue;
    byRegion.get(entry.regionSlug)!.index.push(entry);
  }

  // 6. Fichiers région
  console.log(`🗺  Génération de ${byRegion.size} fichiers région…`);
  for (const [slug, { communes: regionCommunes, index: regionIndex }] of byRegion) {
    const regionName = REGION_MAPPING[regionCommunes[0]?.department]?.name ?? slug;
    const deptCodes = [...new Set(regionCommunes.map((c) => c.department))];
    const summary = buildRegionSummary(slug, regionName, deptCodes, regionCommunes, regionIndex as any);
    writeJson(path.join(DATA_DIR, 'regions', `${slug}.json`), summary);
  }
  console.log(`   → data/regions/ (${byRegion.size} fichiers)`);

  console.log('\n✅ Génération terminée !');
  console.log(`   Thresholds    : data/thresholds.json`);
  console.log(`   Index         : data/index.json (${index.length} communes)`);
  console.log(`   Départements  : data/departments/ (${byDept.size} fichiers)`);
  console.log(`   Régions       : data/regions/ (${byRegion.size} fichiers)`);
}

main().catch((err) => {
  console.error('❌ Erreur fatale :', err);
  process.exit(1);
});
