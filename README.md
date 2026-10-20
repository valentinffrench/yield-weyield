# Yield WeYield – panneau latéral (v3.3.0)

*Chrome side-panel extension for [WeYield](https://www.weyield.io) revenue-management users: overlays pricing periods and cost-break zones on the booking charts, compares ADR (RPJ) with last year / last year final, and flags over- or under-pricing with simple rules and an optional TypeSafe "Jev" check. Unofficial, not affiliated with WeYield or TypeSafe. Documentation below in French.*

Extension Chrome pour le point yield sur `apps.weyield.io` → **Réservations**. Le graphique garde toute sa place : l'extension y dessine les périodes (P10, P11…) et les paliers (cost-breaks), et **tout le reste vit dans le panneau latéral de Chrome** (RPJ N, N-1, N-1 final, réglages).

Chrome 114 ou plus récent.

## Installation / mise à jour
1. `chrome://extensions` → activer le **mode développeur**.
2. Première fois : **Charger l'extension non empaquetée** → choisir ce dossier. Mise à jour : icône ↻ sur la carte de l'extension, puis recharger l'onglet WeYield.
3. Épingler l'extension, puis **cliquer sur son icône** : le panneau s'ouvre à droite (et se referme).

Le panneau suit l'onglet actif. S'il affiche « Page non connectée », rechargez l'onglet WeYield.

## Utilisation
- **Période de travail** (en haut du panneau) : `‹ P12 ›` ou les flèches ← → du clavier. Un **clic sur le graphique** sélectionne aussi la période cliquée (un glisser pour zoomer ne change rien). « Période en cours » revient à celle qui contient la date de référence.
- **Calques** Périodes / Paliers : indépendants, activables ensemble.
- **J0 et décalage** : J0 = premier jour de la période choisie + le décalage (− / + en jours, ↺ pour remettre à 0). Les paliers se calculent depuis J0 : un palier « a-b j » couvre J0+a → J0+b. La ligne « départs » de la période n'est jamais décalée.
- **Synthèse** : RPJ N de la période avec Δ vs N-1 et vs N-1 final.
- **Tableau** : *Paliers de Pk* (départs + un palier par ligne) ou *Toutes les périodes* (clic ou Entrée sur une ligne = la choisir). **Survoler une ligne la fait ressortir sur le graphique.** Chaque colonne N-1 / N-1 final donne la valeur et l'écart. **Copier** exporte en TSV (Excel / Sheets).
- **Réglages** (repliés, résumé en un coup d'œil) : « Période n° 10 commence le 24/07/2026 », durée d'une période, liste des paliers (un champ par palier, couleur identique au graphique, corrigés si incohérents). Tout s'applique immédiatement.
- Thème clair / sombre automatique.

## Signaux prix × volume (onglet « Signaux »)
Pour chaque période à venir, le panneau croise le **volume** (N vs N-1) et le **prix** (RPJ N vs N-1, avec N-1 final en contexte) et rend un verdict : **▲ Relever · ▼ Baisser · ● Tenir · ? Voir**. Le filtre affiché sur la page WeYield fait foi (une catégorie à la fois). Le volume se lit différemment selon la page, et les cartes l'indiquent :
- **Page Réservations → « Portefeuille »** : OnRent déjà acquis vs N-1 à la même date.
- **Page Évolution des réservations → « Rythme »** : réservations nettes captées sur la fenêtre affichée (7 / 14 / 21 / 28 jours) vs N-1, et prix des réservations captées.

**Règles** (gratuites, instantanées) : toujours calculées ; seuils dans `src/signals.js` (`T`), hypothèses de départ à recalibrer avec le journal.

**Jev** (TypeSafe System One), bouton « Analyser avec Jev » :
- Le **code décide seul** ce qu'il sait décider : une période aux données partielles ou au volume faible est tranchée « Voir » sans appeler Jev (carte « Jev n/a »).
- Pour les autres, **une requête par période, 5 questions rapides en parallèle** : deux lectures (volume, prix) pour contrôle, deux oui/non (« prix trop bas ? », « prix trop haut ? ») et un choix direct Tenir / Relever / Baisser.
- Le **verdict est composé des deux oui/non** : trop bas ≥ 60 % et trop haut < 40 % → Relever ; l'inverse → Baisser ; les deux < 40 % → Tenir ; sinon « Voir » (contradictoire ou hésitant). Le choix direct est gardé à côté pour comparer.
- Les champs inconnus sont **omis** de la requête (jamais « not available » : Jev y lit « données manquantes » et répond « Voir » partout, ce qui arrivait sur l'onglet En portefeuille, sans N-1 final). Questions et clés d'état en anglais, langue d'entraînement de Jev.
- **« Détail Jev »** sur chaque carte : probabilités brutes (trop bas / trop haut, choix direct) et « Copier la requête et la réponse brutes » pour diagnostiquer un verdict surprenant.
- Un résultat devient « périmé » (grisé, barré) dès que les chiffres de la période changent.

**Graphique** : seules les exceptions s'affichent (« Tenir » = silence) : la période se teinte (opacité = confiance) et son étiquette reçoit le pictogramme (« P13 ? »). Bascule Jev / Règles dans l'onglet.

**👍 / 👎** sur chaque carte (👎 propose la bonne réponse) : journal local + score « Jev x/y · Règles z/w » (+ Jev choix direct) sur les verdicts étiquetés. C'est l'expérience qui dira si Jev apporte quelque chose par rapport aux règles. Réglages › Jev › « Copier le journal (CSV) ».

**Clé API** : à coller dans Réglages › Jev (stockée dans `chrome.storage.local`, jamais dans la page WeYield). Utilisez une clé dédiée à plafond de dépense. **Rien n'est envoyé sans clé ni sans clic sur « Analyser avec Jev »**, et seulement des écarts relatifs (%), des délais et des libellés de période : jamais de € ni de CA.

## Séries lues (Réglages › Séries lues)
Les dispositions de WeYield ont été **observées sur le vrai site le 20/10/2026** (détail : [docs/weyield-layout.md](docs/weyield-layout.md)). Rôles résolus automatiquement :

| Route | Graphique lu | Volume N | Volume N-1 | Volume N-1 final | RPJ N | RPJ N-1 | RPJ N-1 final | Nature |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `bookings/lastyear` (En portefeuille) | l'unique | `current` | `lastyear` | – | `currentRpd` | `lastyearRpd` | – | Portefeuille |
| `bookings/final` (Final) | l'unique | `current` | – | `lastyearFinal` | `currentRpd` | – | `lastyearFinalRpd` | Portefeuille |
| `new-bookings/1-day`, `7-days`, `30-days` | le second | `thisyear` | `lastyear` | – | `revenue` | `ly_revenue` | – | Rythme · N j |

Les séries anonymes (« Series N »), les flottes et les `delta` ne sont jamais des rôles ; une série sans point (`lastyear` sur Final) compte comme absente. Les libellés d'info-bulle (« OnRent net », « Revenu par jour ») ne sont pas des noms de séries. Le panneau affiche ce qui a été retenu pour chacun des 6 rôles ; une liste déroulante corrige un rôle (mémorisé par disposition de graphique). **Une série ne peut pas servir deux rôles** : un réglage en conflit est ignoré et signalé (« Réglage ignoré »). Le choix manuel d'un graphique n'est honoré que sur ce graphique.

- **Fenêtre du rythme** : sur `new-bookings/*`, la fenêtre « N derniers jours » (boutons radio) est lue et affichée (« Rythme · 7 j »), transmise à Jev, et un changement de fenêtre périme les résultats Jev.
- **Menu « Avancé »** (`bookings/*`) : tant que le mode **RevCar** n'a pas été observé, l'extension n'affiche aucun RPJ dans ce mode (note dédiée) ; repasser sur « Revenu par jour ».
- **Valeurs non finies** : les NaN et ±Infinity des jours sans volume net (`new-bookings/1-day`) sont ignorés ; sur le rythme, un volume net total ≤ 0 donne la moyenne simple des RPJ finis.
- **Libellés sur `new-bookings/*`** : décalés de 16 px pour ne pas recouvrir les « ? » de WeYield (valeur à confirmer à l'œil).

## Lecture des chiffres
- RPJ = CA ÷ jours loués, moyenne pondérée par le nombre de voitures en location (`OnRent` × `Revenu par jour`, comme l'infobulle WeYield).
- N-1 = série `lastyear` (même date) ; N-1 final = série `lastyearFinal`. Si l'affichage WeYield n'en charge qu'une, l'autre colonne est barrée et un message l'indique.
- Seuls les jours chargés dans le graphique comptent : `⚠ 4/7 j chargés` signale une zone coupée.

## Architecture
```
manifest.json         MV3 : side_panel, service worker, deux content scripts
src/core.js           logique pure : dates, paliers, grille de périodes, RPJ, export
src/chart.js          graphiques Highcharts : détection, lecture des séries, dessin   ┐ monde MAIN
src/engine.js         état, calcul, dessin, réception des actions         ┘ (dans la page)
src/signals.js        signaux : caractéristiques, règles, requête et décodage Jev, journal (pur)
src/relay.js          pont chrome.runtime ↔ page (monde isolé, liste blanche)
src/background.js     clic sur l'icône → ouvre le panneau
src/panel/            panel.html / .css / .js : vue + actions, aucun calcul métier
test/core.test.js     tests unitaires        →  node --test test/core.test.js
test/browser/         banc navigateur        →  cd test/browser && npm install && npm test
```
Le panneau ne touche pas à la page : il reçoit des instantanés du moteur et lui renvoie des actions validées (clés autorisées, bornes). L'état est conservé dans le `localStorage` de la page (clé `wyYield3`) ; les réglages des versions précédentes sont repris au premier lancement.

Le banc charge l'extension réelle sur une maquette WeYield (vrai Highcharts, séries nommées comme dans WeYield), ouvre le panneau sur cet onglet et vérifie 114 points (avec une fausse API TypeSafe aux formats documentés) : montage, navigation, décalage, survol, clic/zoom, chiffres recoupés par un calcul indépendant, réglages, copie, reconnexion après rechargement, graphique recréé, états sans page, migration, thème sombre, 320 px.

## Autres versions (sauvegardes dans `prototypes/`)
- `weyield-extension.v2.0.0-drawer.bak/` : barre au-dessus du graphique + tiroir en dessous (sans décalage de J0).
- `weyield-extension.v1.2.1.bak/` : version d'origine.

**N'activez qu'une version à la fois** dans `chrome://extensions` : elles dessinent toutes sur le même graphique.

## Limites connues
- **Jev jamais appelé pour de vrai** par l'auteur de ces tests : la chaîne est testée avec une fausse API aux formats de la documentation (noul / choice / score). Commencez par « Tester la clé » ; si une erreur « Réponse Jev inattendue » ou 422 apparaît, c'est un écart de format à corriger.
- Seuls `bookings/lastyear`, `bookings/final` et `new-bookings/{1,7,30}-days` ont été observés ; les autres routes (Évolution, Estimé, Transactions, Air Analytics…) peuvent donner des lectures vides ou fausses. Le mode RevCar, les fenêtres autres que celle par défaut et le sens des RPJ négatifs ne sont pas observés (voir la fin de `docs/weyield-layout.md`).
- Les N-1 sont alignés par WeYield à 364 jours (même jour de semaine) : Pâques, carnaval, Route du Rhum… faussent la comparaison. Pas de calendrier d'événements pour l'instant.
- Les seuils des signaux (`T` dans `src/signals.js`) ont été fixés pour des volumes de portefeuille ; sur une fenêtre de 1 jour les volumes nets sont minuscules et les pourcentages varient beaucoup : à recalibrer avec le journal 👍/👎.
- Fermer le panneau ne retire pas l'overlay du graphique : il reste tel que configuré.

## Confidentialité
L'extension ne contacte aucun serveur de son propre chef. Elle lit les graphiques de la page `apps.weyield.io` ouverte dans votre navigateur et garde ses réglages localement (`localStorage` de la page, `chrome.storage.local` du panneau). Seul l'appel optionnel « Analyser avec Jev » sort vers `api.typesafe.ai`, avec votre propre clé et uniquement des écarts relatifs (jamais de montants). Aucune télémétrie.

## Licence
MIT, voir [LICENSE](LICENSE). « WeYield » et « Jev / TypeSafe » appartiennent à leurs propriétaires ; ce projet n'est ni affilié à eux ni approuvé par eux.
