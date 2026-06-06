/**
 * Supprime le dossier data/ généré par npm run data:generate.
 *
 * Usage : npm run data:clean
 */
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.log('ℹ️  Le dossier data/ n\'existe pas, rien à nettoyer.');
    return;
  }

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log('🗑  Dossier data/ supprimé');
}

main().catch((err) => {
  console.error('❌ Erreur :', err);
  process.exit(1);
});
