# Balance de flotte Rentway : structure observée (2026-11-20)

Référence pour l'adaptateur Rentway de l'extension (pendant de `docs/weyield-layout.md`). Observé sur le site réel le 20/11/2026, compte CARIBE CAR / Agence Aéroport, station PTP /AEROPORT DE PTP, du 02/12/2026 au 31/05/2027, toutes catégories, tous types de flotte. Un compte, un état de filtre, une journée.

Un essai de calque (périodes hebdo + paliers 1-2 à 31-60 j) a été dessiné puis retiré : alignement, défilement et redessin validés (voir §5).

## 1. Environnement

| Élément | Valeur observée |
| --- | --- |
| URL | `https://rentwayv1.emotionmobility.com/?subscription=<uuid>` |
| Routage | **Aucun changement d'URL** : chemin `/`, pas de hash, pas de vue-router. La page affichée est un composant asynchrone (`MainPage.$data.currentPage`). |
| Authentification | Keycloak, `identity.emotionmobility.com/realms/rentway` (iframe de statut de session) |
| Framework | Vue 2 + Vuetify (`v-main`, `v-card`), bundle vue-cli (`js/app.*.js`, `chunk-*.js`) |
| Grille | **DevExtreme PivotGrid** (`chunk-devextreme`), via `devextreme-vue` |
| Globaux | ni `window.DevExpress`, ni `window.Highcharts`, ni jQuery |
| Langue | `<html lang="en">`, libellés traduits par `$t()` ; en-têtes de date au format `dd-MM` **sans année** |
| Fuseau | dates locales sans `Z` (`"2026-12-02T00:00:00"`), lues en heure locale (UTC-4) |

## 2. Accès au composant

```js
const el   = document.getElementById('pivotgrid');               // div.dx-pivotgrid
const inst = el.__vue__.instance;                                  // instance dxPivotGrid
const ctl  = el.closest('.component').__vue__;                     // composant Vue « fleetBalanceControl »
```

Chaîne Vue : `fleetBalanceControl` → `v-main` → `MainPage` → `v-main` → `app`.

`inst.on('contentReady', fn)` / `inst.off(...)` fonctionnent (abonnement sans toucher au code Rentway).

## 3. Données

### Appel API
- `POST /dashboard/fleetbalance` (méthode `wsGetFleetBalance`), corps : `{ startDate, endDate, stationIDs, zoneIDs, countryIDs, groupIDs, segmentIDs, fleetTypeIDs, groupedStations }` (listes d'ID séparées par des virgules).
- Détail d'une cellule (clic) : `POST /dashboard/fleetbalance/details` (méthode `showDetail` → `wsGetFleetBalanceDetails`).
- Le résultat est transformé par `getDs()` et rangé dans `ctl.fbResult = { fields, store }`.

### Enregistrement brut (`ctl.fbResult.store`, 3 801 lignes = 21 catégories × 181 jours)
```json
{ "locationID": "APT", "locationName": "PTP /AEROPORT DE PTP", "groupID": "MBMR",
  "date": "2026-12-02T00:00:00", "availableVehicles": 9, "totalVehicles": 60 }
```
- `availableVehicles` : véhicules disponibles ce jour-là (peut être **négatif** = surbooking).
- `totalVehicles` : flotte de la catégorie à la station. **Non affichée** dans la grille (champ ligne invisible) mais présente dans chaque enregistrement → permet de calculer le taux d'utilisation.

### Champs du PivotGrid (`inst.getDataSource().fields()`)
| Zone | Champ | Remarque |
| --- | --- | --- |
| ligne | `locationID` | invisible |
| ligne | `locationName` | « Location » (ou zone / pays selon le bouton station/zone/pays) |
| ligne | `groupID` | « Group » = catégorie ACRISS (ou segment selon le bouton groupes/segments) |
| ligne | `totalVehicles` | invisible |
| colonne | `date` | sélecteur → `new Date(date)`, format `dd-MM` |
| donnée | `availableVehicles` | `sum` |

### Grille calculée (`inst.getDataSource().getData()`)
- `columns[k].value` = objet `Date` (minuit local) ; 181 colonnes, **pas de total de colonne** (`showColumnGrandTotals: false`). L'ordre de `columns` = l'ordre des `<td>` d'en-tête.
- `rows[0]` = la station, `rows[0].children[i]` = catégories ; lignes de total station + total général (`showRowTotals`, `showRowGrandTotals`).
- `values[rowIndex][colIndex][0]` (index 0 = total).

### Filtres lus sur `ctl`
`startDate`, `endDate`, `selectedStations`, `selectedGroups`, `selectedSegments`, `selectedFleetTypes` (BB, DEFISC, EPAVE, FP, CDE, PART, SL, SR, VO, VOL), `btnStationZoneCountry` (`stations` | `zones` | `countries`), `btnGroupsSegments` (`groups` | `segments`), `onlyGroupedStations`, `fieldOnTable`.

## 4. Code couleur Rentway (`getColorBalance(dispo, total)`)

Taux d'occupation `u = 1 − dispo / total`, seuils `ctl.color1..4` = 25 / 50 / 75 / 100 :

| Condition | Couleur |
| --- | --- |
| `total ≤ 0` (catégorie sans flotte, ex. IVMD) | noir `#000` (texte blanc) |
| `dispo < 0` (surbooking) | rouge `#ff7463` |
| u ≤ 25 % | bleu `#b9e2f3` |
| u ≤ 50 % | vert `#cee9cf` |
| u ≤ 75 % | jaune `#ffc82f` |
| u ≤ 100 % | rouge `#ff7463` |

Le rouge démarre donc à 75 % d'occupation, en dessous des seuils yield de référence (81-82 % confortable, 86 % limite, 87 % pic).

## 5. DOM et dessin

```
#pivotgrid.dx-pivotgrid
 └ table.dx-pivotgrid-border
    ├ td.dx-area-description-cell     (boutons Location / Group, export xlsx)
    ├ td.dx-area-column-cell          en-têtes de date
    │   └ .dx-scrollable.dx-scrollable-simulated > .dx-scrollable-container > .dx-scrollable-content > table (1 ligne, 181 td)
    ├ td.dx-area-row-cell             station + catégories (2 colonnes)
    └ td.dx-area-data-cell            valeurs
        └ .dx-scrollable.dx-scrollable-simulated > .dx-scrollable-container > .dx-scrollable-content > table (23 lignes × 181 td)
```

- **Largeur des colonnes variable** (41 à 48 px) : positionner avec `td.offsetLeft / offsetWidth`, jamais avec une largeur fixe.
- Hauteur des lignes ≈ 33-34 px ; en-tête ≈ 86 px.
- **Défilement horizontal** : `scrollLeft` sur `.dx-scrollable-container` (overflow masqué, pas de `transform`). En-tête et données sont synchronisés par DevExtreme.
- **Méthode validée** : un calque `position:absolute; pointer-events:none` ajouté dans chaque `.dx-scrollable-content` (rendu `position:relative`) défile tout seul avec la grille et laisse passer les clics (le clic sur une cellule ouvre le détail Rentway).
- `inst.repaint()` et `dataSource.reload()` conservent le calque et déclenchent `contentReady` → redessiner sur `contentReady` (les colonnes peuvent changer après une nouvelle recherche).
- Couleur des cellules posée en style inline par `onCellPrepared` de Rentway : ne pas la réécrire, superposer.
- Pas de rangée libre au-dessus des dates : prévoir une bande de 16 px pour les étiquettes de période (sinon elles masquent la date).

## 6. Conséquences pour l'extension (mises en œuvre en v3.5.0 : `src/pivot.js`)

| Sujet | WeYield (actuel) | Rentway (à faire) |
| --- | --- | --- |
| Correspondance | `apps.weyield.io/*` | `rentwayv1.emotionmobility.com/*` |
| Détection | `app-chart` + `__ngContext__` | `#pivotgrid.__vue__.instance`, surveillé par `MutationObserver` (aucun changement d'URL) |
| Axe du temps | x datetime UTC | `columns[k].value` (Date locale) → convertir en jour UTC via `Date.UTC(y, m, d)` |
| Dessin | `addPlotBand` Highcharts | calques DOM dans les deux `.dx-scrollable-content` |
| Mesures | RPJ, volume N / N-1 | dispo et flotte par catégorie × jour → taux d'occupation par période et par palier (pas de prix, pas de N-1) |

Architecture retenue : `src/pivot.js` expose dans `WY.src` la même interface que `src/chart.js` (trouver, lire, dessiner, effacer, clic, diagnostic, statistiques de zone) ; `engine.js` ne connaît que `WY.src`. La grille de périodes et les paliers de `core.js` sont réutilisés tels quels ; l'occupation par zone (`fleetZoneStats`) y est ajoutée. L'onglet Signaux et Jev restent propres à WeYield.

Validé le 20/11/2026 sur le vrai Rentway (injection temporaire, retirée ensuite) : 3 801 enregistrements, 21 catégories, calques alignés à 1 px près, clic sur une date → période, survol, redimensionnement de la fenêtre.

## 7. Non vérifié

- Vue par **zones / pays** ou par **segments** (libellés de lignes différents).
- Plusieurs stations à la fois (plusieurs blocs de lignes).
- Plages longues : 181 colonnes rendues sans virtualisation (`scrolling.mode: standard`) ; au-delà de `renderCellCountLimit`, DevExtreme peut virtualiser et les `td` hors écran n'existeraient plus.
- Nouvelle interface Rentway (`goToApplicationV2`) : non ouverte.
- Comportement après déconnexion Keycloak / changement de souscription.
