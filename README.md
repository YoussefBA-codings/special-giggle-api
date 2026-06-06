# API Immobilière Nationale

API NestJS exposant les données d'investissement immobilier pour les 34 746 communes françaises.

---

## Installation

```bash
# Si node_modules est owned par root (première fois)
sudo rm -rf node_modules package-lock.json
npm install
```

---

## Démarrage rapide

```bash
npm run data:generate   # 1. Génère les fichiers optimisés (faire une fois)
npm run start:dev       # 2. Démarre l'API sur http://localhost:3000
```

---

## Scripts de données

### `npm run data:generate`

**Ce qu'il fait :**

Lit `communes-all.final.json` (157 MB, 34 746 communes) et génère le dossier `data/` :

```
data/
  thresholds.json          — seuils de percentile du dataset (p10, p25, p50, p75, p90)
                             pour chaque métrique : rendement, prix, loyer, vacance, revenu, croissance
  index.json               — entrée légère par commune (~10 MB au lieu de 157 MB)
                             contient : inseeCode, ville, dept, région, prix, rendements, scores
  departments/
    01.json                — agrégats du département Ain
    02.json                — agrégats du département Aisne
    ...                    — un fichier par département (96 au total)
  regions/
    ile-de-france.json     — agrégats de la région Île-de-France
    occitanie.json         — agrégats de l'Occitanie
    ...                    — un fichier par région (18 au total)
```

**Chaque fichier département/région contient :**
- nombre de communes, population totale
- prix moyens (appartement, maison), loyers moyens, rendements moyens
- scores moyens (global, rendement, cashflow, patrimonial, débutant, risque)
- vacance moyenne, part de locataires, revenu médian moyen
- top 5 communes par score global, rendement, cashflow, patrimonial, débutant
- top 5 communes les moins risquées
- top 5 yield traps (rendement élevé mais risque sous-estimé)

**Durée :** ~30 à 60 secondes selon la machine.

**À relancer quand :** tu mets à jour `communes-all.final.json` via le pipeline de scraping.

---

### `npm run data:update:city -- <inseeCode>`

**Ce qu'il fait :**

Met à jour une seule commune sans relancer la génération complète.

```bash
npm run data:update:city -- 75056    # Paris
npm run data:update:city -- 92012    # Bois-Colombes
npm run data:update:city -- 69123    # Lyon
```

**Étapes exécutées :**
1. Trouve la commune par son code INSEE dans `communes-all.final.json`
2. Recalcule ses scores d'investissement en utilisant les seuils de `data/thresholds.json` (Option C)
3. Met à jour son entrée dans `communes-all.final.json`
4. Met à jour son entrée dans `data/index.json`
5. Régénère `data/departments/<code>.json` (son département)
6. Régénère `data/regions/<slug>.json` (sa région)

**Limitation connue :** les scores sont recalculés avec les seuils de percentile du *dernier* `data:generate` complet. Si le marché a beaucoup bougé, les scores peuvent être légèrement décalés. Relancer `data:generate` une fois par mois pour recalibrer.

**À utiliser quand :** tu as mis à jour manuellement les données brutes (prix, INSEE, transport) d'une commune dans `communes-all.final.json`.

---

### `npm run data:update:department -- <code>`

**Ce qu'il fait :**

Régénère uniquement les agrégats d'un département et de sa région.

```bash
npm run data:update:department -- 92    # Hauts-de-Seine
npm run data:update:department -- 2A    # Corse-du-Sud
npm run data:update:department -- 971   # Guadeloupe
```

**Étapes exécutées :**
1. Relit toutes les communes du département depuis `communes-all.final.json`
2. Régénère `data/departments/<code>.json`
3. Régénère `data/regions/<slug>.json` (la région contenant ce département)

**Ne recalcule pas** les scores individuels des communes — uniquement les agrégats.

**À utiliser quand :** plusieurs communes d'un même département ont été mises à jour et tu veux recalculer les moyennes sans relancer le tout.

---

### `npm run data:update:region -- <slug>`

**Ce qu'il fait :**

Régénère uniquement les agrégats d'une région.

```bash
npm run data:update:region -- ile-de-france
npm run data:update:region -- occitanie
npm run data:update:region -- provence-alpes-cote-d-azur
```

**Slugs disponibles :**
`auvergne-rhone-alpes`, `bourgogne-franche-comte`, `bretagne`, `centre-val-de-loire`,
`corse`, `grand-est`, `hauts-de-france`, `ile-de-france`, `normandie`,
`nouvelle-aquitaine`, `occitanie`, `pays-de-la-loire`, `provence-alpes-cote-d-azur`,
`guadeloupe`, `martinique`, `guyane`, `la-reunion`, `mayotte`

**Étapes exécutées :**
1. Relit toutes les communes de la région depuis `communes-all.final.json`
2. Régénère `data/regions/<slug>.json`

---

### `npm run data:clean`

**Ce qu'il fait :**

Supprime le dossier `data/` entier (thresholds, index, departments, regions).

```bash
npm run data:clean
```

Utile pour repartir de zéro avant un `data:generate` complet.

---

## Scripts API

### `npm run start:dev`

Démarre le serveur NestJS en mode développement avec hot-reload.

Au démarrage, le serveur :
1. Charge `communes-all.final.json` en mémoire (~2-4 secondes)
2. Construit les Maps d'indexation (inseeCode → commune, département, région)
3. Charge `data/index.json` et `data/thresholds.json` si disponibles
4. Pré-trie les tableaux de classement (global, rendement, cashflow…)
5. Démarre l'écoute sur le port 3000

### `npm run build`

Compile le TypeScript vers `dist/`.

### `npm run start:prod`

Démarre le serveur compilé (après `npm run build`).

---

## Routes API

### Communes

| Route | Description |
|---|---|
| `GET /cities` | Liste paginée avec filtres et tri |
| `GET /cities/:inseeCode` | Détail complet d'une commune |
| `GET /cities/compare?codes=75056,92012,69123` | Comparaison de plusieurs communes |

**Filtres disponibles sur `GET /cities` :**

| Paramètre | Exemple | Description |
|---|---|---|
| `search` | `?search=lyon` | Recherche par nom, code postal, ou code INSEE |
| `department` | `?department=69` | Filtrer par département |
| `region` | `?region=occitanie` | Filtrer par région (slug) |
| `profile` | `?profile=BEGINNER_FRIENDLY` | Profil investisseur |
| `riskLevel` | `?riskLevel=LOW` | Niveau de risque (LOW, MEDIUM, HIGH) |
| `dataQuality` | `?dataQuality=HIGH` | Qualité des données (HIGH, MEDIUM, LOW) |
| `minGlobalScore` | `?minGlobalScore=60` | Score global minimum (0-100) |
| `maxGlobalScore` | `?maxGlobalScore=80` | Score global maximum |
| `minYield` | `?minYield=5` | Rendement brut minimum (%) |
| `maxYield` | `?maxYield=10` | Rendement brut maximum |
| `minPrice` | `?minPrice=1000` | Prix minimum (€/m²) |
| `maxPrice` | `?maxPrice=3000` | Prix maximum |
| `sortBy` | `?sortBy=yieldScore` | Champ de tri |
| `sortOrder` | `?sortOrder=desc` | Ordre (asc ou desc) |
| `page` | `?page=2` | Page (défaut : 1) |
| `limit` | `?limit=50` | Résultats par page (max 200, défaut : 20) |

**Valeurs de `sortBy` :** `globalScore`, `yieldScore`, `cashflowScore`, `beginnerScore`, `patrimonialScore`, `riskScore`, `population`, `apartmentPrice`, `apartmentYield`, `city`

**Profils disponibles :** `BEGINNER_FRIENDLY`, `BALANCED_OPPORTUNITY`, `HIGH_YIELD`, `PATRIMONIAL`, `YIELD_TRAP`, `DEFAULT`

---

### Régions

| Route | Description |
|---|---|
| `GET /regions` | Liste de toutes les régions avec résumé |
| `GET /regions/:slug` | Détail complet d'une région (agrégats, top communes) |
| `GET /regions/:slug/cities?page=1&limit=20` | Communes de la région, triées par score global |

---

### Départements

| Route | Description |
|---|---|
| `GET /departments` | Liste de tous les départements avec résumé |
| `GET /departments/:code` | Détail complet d'un département (agrégats, top communes) |
| `GET /departments/:code/cities?page=1&limit=20` | Communes du département, triées par score global |

---

### Classements

Tous les classements retournent au maximum 50 communes par défaut (paramètre `?limit=N`).

| Route | Classement |
|---|---|
| `GET /rankings/global` | Meilleurs scores globaux d'investissement |
| `GET /rankings/yield` | Meilleurs rendements bruts |
| `GET /rankings/cashflow` | Meilleur cashflow potentiel |
| `GET /rankings/patrimonial` | Meilleurs profils patrimoniaux |
| `GET /rankings/beginner` | Meilleures villes pour débutants |
| `GET /rankings/low-risk` | Villes les moins risquées |
| `GET /rankings/yield-traps` | Yield traps (rendement élevé, risque caché) |
| `GET /rankings/long-term` | Meilleures perspectives long terme |
| `GET /rankings/rental-demand` | Meilleure demande locative |

---

## Architecture

```
communes-all.final.json          ← source de vérité (jamais modifié par l'API)
data/                            ← généré par npm run data:generate
  thresholds.json                ← seuils de percentile (pour recalcul partiel)
  index.json                     ← index léger (~10 MB) pour listes et filtres
  departments/<code>.json        ← agrégats par département
  regions/<slug>.json            ← agrégats par région
src/
  modules/
    data/                        ← DataLoaderService (charge tout en mémoire au démarrage)
    communes/                    ← GET /cities
    regions/                     ← GET /regions
    departments/                 ← GET /departments
    rankings/                    ← GET /rankings
  shared/
    types/                       ← interfaces TypeScript
    constants/                   ← mapping département → région
    utils/                       ← pagination, scoring, slugify
  scripts/                       ← commandes CLI indépendantes de l'API
```

**Principe de fonctionnement :**
- Au démarrage, les 34 746 communes sont chargées en mémoire dans des `Map` indexées
- Les listes et filtres utilisent `data/index.json` (entrée légère, ~300 octets/commune)
- Les détails individuels sont servis depuis la Map en mémoire (O(1))
- Les agrégats région/département sont lus depuis les fichiers JSON générés
- Les classements sont pré-triés au démarrage pour des réponses instantanées

---

## Pipeline de mise à jour des données source

Pour mettre à jour les données brutes (prix DVF, INSEE, transport) :

```bash
# Extraction des prix DVF
python3 extract-dvf-all.py

# Enrichissement (dans cet ordre)
node build-all-communes-geo.js
node enrich-insee.js
node enrich-transport-v2.js

# Reconstruction complète
node build-communes-all-pipeline.js

# Puis regénérer les fichiers API
npm run data:generate
```

Ou en une seule commande via le script d'orchestration :

```bash
./run-communes-all.sh
npm run data:generate
```
