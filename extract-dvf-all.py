#!/usr/bin/env python3
"""
Extrait et agrège les transactions DVF 2023 pour TOUTES les communes de France.

Contrairement à extract-dvf-national.py, aucun filtre sur la liste des communes :
on traite l'intégralité du ZIP (3.8M lignes) et on restitue des STATISTIQUES
pré-agrégées (une ligne par commune × type), ce qui évite un CSV de plusieurs GB.

Input  : /tmp/dvf2023.zip (France métro entière)
Output : dvf-all-stats.csv

Format de sortie (séparateur ;) :
    code_commune ; type_local ; nb_transactions ; prix_median ; prix_p10 ; prix_p90

Arrondissements remappés vers la ville principale :
    Paris 75101-75120 → 75056
    Lyon  69381-69389 → 69123
    Marseille 13201-13216 → 13055
"""

import zipfile
import re
from collections import defaultdict

ZIP_PATH    = "/tmp/dvf2023.zip"
OUTPUT_FILE = "dvf-all-stats.csv"

# Indices dans le fichier DVF pipe-separated (base CEREMA)
IDX_MUT  = 0   # Identifiant de document (clé de mutation)
IDX_VAL  = 10  # Valeur foncière
IDX_DEP  = 18  # Code département
IDX_COM  = 19  # Code commune (3-4 chars dans le dept)
IDX_TYPE = 35  # Code type local : 1=Maison, 2=Appartement
IDX_SURF = 38  # Surface réelle bâtie (m²)

# Arrondissements → ville principale (code INSEE complet)
ARROND_MAP = {
    **{f"75{str(100 + i).zfill(3)}": "75056" for i in range(1, 21)},   # Paris
    **{f"69{str(380 + i).zfill(3)}": "69123" for i in range(1, 10)},   # Lyon
    **{f"13{str(200 + i).zfill(3)}": "13055" for i in range(1, 17)},   # Marseille
}


def normalize_insee(dept, com):
    dept = dept.strip()
    com  = com.strip().lstrip("0")
    if not dept or not com:
        return None
    # Corse : 2A / 2B
    if re.match(r"^2[AB]$", dept, re.IGNORECASE):
        return dept.upper() + com.zfill(3)
    try:
        return f"{int(dept):02d}{int(com):03d}"
    except ValueError:
        return None


def classify_type(type_code_str):
    c = type_code_str.strip()
    if c == "1":
        return "Maison"
    if c == "2":
        return "Appartement"
    return None


def parse_float(s):
    s = s.strip().replace(" ", "")
    if not s or s == "-":
        return None
    try:
        return float(s.replace(",", "."))
    except ValueError:
        return None


def percentile(sorted_vals, p):
    """Interpolation linéaire — même algo que le script Node.js."""
    if not sorted_vals:
        return None
    n = len(sorted_vals)
    if n == 1:
        return sorted_vals[0]
    idx = (p / 100.0) * (n - 1)
    lo  = int(idx)
    hi  = min(lo + 1, n - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (idx - lo)


def main():
    # -------------------------------------------------------------------------
    # Phase 1 : lecture streaming du ZIP → groupement par (mutation, commune)
    # -------------------------------------------------------------------------
    # On ne filtre PAS par liste de communes cibles : on traite tout.
    mutations = defaultdict(list)   # (mut_key, commune) → [{val, surf, type}]
    skipped   = 0
    line_num  = 0

    print(f"Reading {ZIP_PATH}  (aucun filtre commune)...")
    with zipfile.ZipFile(ZIP_PATH) as z:
        fname = z.namelist()[0]
        print(f"  Fichier interne : {fname}")
        with z.open(fname) as f:
            header = f.readline().decode("latin-1").strip().split("|")
            print(f"  Colonnes : {len(header)}")
            col_check = max(IDX_VAL, IDX_DEP, IDX_COM, IDX_TYPE, IDX_SURF)

            for raw in f:
                line_num += 1
                try:
                    line = raw.decode("latin-1").strip()
                except Exception:
                    continue
                if not line:
                    continue

                parts = line.split("|")
                if len(parts) <= col_check:
                    skipped += 1
                    continue

                code = normalize_insee(parts[IDX_DEP], parts[IDX_COM])
                if not code:
                    continue
                code = ARROND_MAP.get(code, code)   # remap arrondissements

                val  = parse_float(parts[IDX_VAL])
                surf = parse_float(parts[IDX_SURF])
                typ  = classify_type(parts[IDX_TYPE])
                mut  = parts[IDX_MUT].strip() or f"{code}|{line_num}"

                if not typ:
                    continue

                mutations[(mut, code)].append({
                    "val":  val if (val and val > 0) else None,
                    "surf": surf or 0.0,
                    "type": typ,
                })

                if line_num % 1_000_000 == 0:
                    print(f"  {line_num:,} lignes traitées, {len(mutations)} groupes de mutation...")

    print(f"\n  Total : {line_num:,} lignes, {skipped} malformées, {len(mutations)} groupes")

    # -------------------------------------------------------------------------
    # Phase 2 : mutation → prix au m² par commune+type
    # -------------------------------------------------------------------------
    commune_prices = defaultdict(lambda: {"Appartement": [], "Maison": []})

    for (mut_key, commune), txs in mutations.items():
        apt   = [t for t in txs if t["type"] == "Appartement"]
        house = [t for t in txs if t["type"] == "Maison"]

        # Mutation mixte (appt + maison) → ignorée (données peu fiables)
        if apt and house:
            continue

        relevant = apt if apt else house
        if not relevant:
            continue

        typ   = relevant[0]["type"]
        price = next((t["val"] for t in txs if t["val"]), None)
        if not price or price <= 1000:
            continue

        total_surf = sum(t["surf"] for t in relevant)
        if total_surf <= 9:
            continue

        ppm = price / total_surf
        # Filtre outliers : < 300 €/m² ou > 30 000 €/m²
        if ppm < 300 or ppm > 30_000:
            continue

        commune_prices[commune][typ].append(ppm)

    # -------------------------------------------------------------------------
    # Phase 3 : calcul des statistiques et écriture CSV
    # -------------------------------------------------------------------------
    rows = []
    for commune, types in commune_prices.items():
        for typ, prices in types.items():
            if not prices:
                continue
            s   = sorted(prices)
            med = percentile(s, 50)
            p10 = percentile(s, 10)
            p90 = percentile(s, 90)
            rows.append({
                "code_commune":    commune,
                "type_local":      typ,
                "nb_transactions": len(s),
                "prix_median":     round(med),
                "prix_p10":        round(p10),
                "prix_p90":        round(p90),
            })

    rows.sort(key=lambda r: (r["code_commune"], r["type_local"]))

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write("code_commune;type_local;nb_transactions;prix_median;prix_p10;prix_p90\n")
        for r in rows:
            f.write(
                f"{r['code_commune']};{r['type_local']};{r['nb_transactions']};"
                f"{r['prix_median']};{r['prix_p10']};{r['prix_p90']}\n"
            )

    print(f"\nSaved {len(rows)} rows → {OUTPUT_FILE}")

    # -------------------------------------------------------------------------
    # Statistiques finales
    # -------------------------------------------------------------------------
    communes_avec_data = len(set(r["code_commune"] for r in rows))
    apt_rows   = [r for r in rows if r["type_local"] == "Appartement"]
    house_rows = [r for r in rows if r["type_local"] == "Maison"]
    total_txs  = sum(r["nb_transactions"] for r in rows)

    print(f"\n  Communes avec ≥1 transaction DVF : {communes_avec_data:,}")
    print(f"  Dont appartements : {len(apt_rows):,}  |  maisons : {len(house_rows):,}")
    print(f"  Transactions valides totales     : {total_txs:,}")

    if apt_rows:
        med_apt = sorted(r["prix_median"] for r in apt_rows)
        print(f"  Médiane des médianes appt : {round(percentile(med_apt, 50)):,} €/m²")
    if house_rows:
        med_hse = sorted(r["prix_median"] for r in house_rows)
        print(f"  Médiane des médianes maison : {round(percentile(med_hse, 50)):,} €/m²")

    top = sorted(rows, key=lambda r: r["nb_transactions"], reverse=True)[:10]
    print("\nTop 10 communes par volume de transactions :")
    for r in top:
        print(f"  {r['code_commune']}  {r['type_local']:<12} : {r['nb_transactions']:>5} txs, "
              f"médiane {r['prix_median']:>6} €/m²  [P10={r['prix_p10']:>6} P90={r['prix_p90']:>6}]")


if __name__ == "__main__":
    main()
