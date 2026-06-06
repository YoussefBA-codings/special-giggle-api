#!/bin/bash
# =============================================================================
# run-communes-all.sh — Pipeline complet : toutes les communes de France
# ~34 700 communes avec geo, prix DVF, loyers, INSEE, transport, investment, insights
#
# Durée estimée : ~10-15 minutes (dont ~8 min Overpass + 5 min Python DVF)
# Output final : communes-all.final.json (~80-120 MB)
#
# Prérequis :
#   - /tmp/dvf2023.zip présent (France entière, 3.8M lignes)
#   - node + python3 installés
# =============================================================================

set -e  # stopper en cas d'erreur

echo "=========================================="
echo " Pipeline toutes communes France"
echo " $(date)"
echo "=========================================="

# Étape 1 : Géographie (API Geo gouv)
echo ""
echo "[1/7] Géographie — 34 700 communes..."
node build-all-communes-geo.js

# Étape 2 : DVF — extraction statistiques pré-agrégées
echo ""
echo "[2/7] DVF — extraction ZIP 3.8M lignes..."
python3 extract-dvf-all.py

# Étape 3 : INSEE (bulk download, ~30 sec)
echo ""
echo "[3/7] INSEE enrichissement..."
INPUT_FILE=communes-all.geo.json \
OUTPUT_FILE=communes-all.insee.json \
LOG_FILE=enrich-insee-all.log \
node enrich-insee.js

# Étape 4 : Merge prix + loyers + INSEE
echo ""
echo "[4/7] Calcul des prix et scores de fiabilité..."
node build-communes-all-pipeline.js

# Étape 5 : Stations transport (Overpass, ~8-12 min)
echo ""
echo "[5/7] Stations transport (Overpass 11 régions)..."
node build-stations-france.js

# Étape 6 : Enrichissement transport (index spatial, ~30-60 sec)
echo ""
echo "[6/7] Enrichissement transport..."
INPUT_FILE=communes-all.prices.json \
STATIONS_FILE=stations-france.json \
OUTPUT_FILE=communes-all.transport.json \
LOG_FILE=enrich-transport-all.log \
node enrich-transport-v2.js

# Étape 7 : Investment + Insights
echo ""
echo "[7/7] Calcul investment scores et insights..."
INPUT_FILE=communes-all.transport.json \
OUTPUT_FILE=communes-all.final.json \
node build-insights.js

echo ""
echo "=========================================="
echo " TERMINÉ — $(date)"
ls -lh communes-all.final.json
echo "=========================================="
