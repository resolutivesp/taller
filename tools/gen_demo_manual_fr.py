#!/usr/bin/env python3
"""Génère demo/demo-manual-fr.pdf — manuel de service ORIGINAL et FICTIF (français)
pour la démo de Taller. L'appareil « OpenMed SP-100 » n'existe pas.
Même structure de pages que la version EN (les suggestions pointent p.7/p.8)."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, PageBreak)

OUT = "/root/work/taller/demo/demo-manual-fr.pdf"

styles = getSampleStyleSheet()
H1 = ParagraphStyle('H1x', parent=styles['Heading1'], fontSize=17, spaceAfter=8, textColor=colors.HexColor('#0e7c72'))
H2 = ParagraphStyle('H2x', parent=styles['Heading2'], fontSize=13, spaceAfter=6, textColor=colors.HexColor('#0e7c72'))
BODY = ParagraphStyle('Bodyx', parent=styles['BodyText'], fontSize=10, leading=14)
WARN = ParagraphStyle('Warnx', parent=BODY, backColor=colors.HexColor('#fff3cd'),
                      borderPadding=6, borderColor=colors.HexColor('#d9a706'), borderWidth=1)
SMALL = ParagraphStyle('Smallx', parent=BODY, fontSize=8.5, textColor=colors.grey)

def T(data, widths=None, header=True):
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#b8c4cc')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]
    if header:
        style += [('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0e7c72')),
                  ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                  ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold')]
    t.setStyle(TableStyle(style))
    return t

def P(text, style=BODY):
    return Paragraph(text, style)

doc = SimpleDocTemplate(OUT, pagesize=A4, topMargin=18*mm, bottomMargin=16*mm,
                        leftMargin=18*mm, rightMargin=18*mm,
                        title="SP-100 Aspirateur de mucosités — Manuel de service (DÉMO)",
                        author="Projet Taller (appareil fictif de démonstration)")

E = []

# ---- p1 couverture ----
E += [Spacer(1, 30*mm),
      P("OpenMed Instruments (fictif)", SMALL),
      P("Aspirateur de mucosités SP-100", ParagraphStyle('T', parent=H1, fontSize=24, leading=28)),
      P("MANUEL DE SERVICE", ParagraphStyle('T2', parent=H1, fontSize=18)),
      Spacer(1, 8*mm),
      P("Document SP100-SM-FR · Révision 2.1", BODY),
      Spacer(1, 14*mm),
      P("<b>MANUEL DE DÉMONSTRATION.</b> Document original et fictif créé pour démontrer "
        "l'application Taller. L'appareil n'existe pas. Ne pas utiliser pour une maintenance "
        "réelle. Pour un vrai travail, importez le manuel du fabricant de votre équipement.", WARN),
      PageBreak()]

# ---- p2 sommaire ----
E += [P("Sommaire", H1),
      T([["Section", "Page"],
         ["1. Consignes de sécurité", "3"],
         ["2. Caractéristiques techniques", "4"],
         ["3. Vue d'ensemble de l'appareil", "5"],
         ["4. Principe de fonctionnement", "6"],
         ["5. Codes erreur", "7"],
         ["6. Dépannage — problèmes d'aspiration", "8"],
         ["7. Dépannage — alimentation et moteur", "9"],
         ["8. Dépannage — surchauffe et bruit", "10"],
         ["9. Calendrier de maintenance préventive", "11"],
         ["10. Nettoyage et désinfection", "12"],
         ["11. Pièces détachées", "13"],
         ["12. Test de vide et étalonnage", "14"]], widths=[120*mm, 30*mm]),
      PageBreak()]

# ---- p3 sécurité ----
E += [P("1. Consignes de sécurité", H1),
      P("<b>AVERTISSEMENT — Risque électrique.</b> Débranchez la fiche secteur avant d'ouvrir le "
        "boîtier. Le condensateur C4 peut rester chargé jusqu'à 60 secondes après l'arrêt. "
        "Attendez une minute avant de toucher la carte de commande du moteur.", WARN),
      Spacer(1, 4),
      P("<b>AVERTISSEMENT — Risque biologique.</b> Le bocal de recueil, son couvercle, la soupape à "
        "flotteur et la tubulure patient doivent être traités comme contaminés. Portez des gants. "
        "Désinfectez avant toute intervention (voir section 10).", WARN),
      Spacer(1, 4),
      P("<b>ATTENTION.</b> Ne faites jamais fonctionner la pompe sans le filtre antibactérien. "
        "L'entrée de liquide dans la tête de pompe est la première cause de défaillance prématurée "
        "des membranes.", WARN),
      Spacer(1, 6),
      P("Seuls des techniciens biomédicaux formés doivent intervenir sur cet appareil. Après toute "
        "réparation, effectuez le test de vide de la section 12 avant remise en service clinique. "
        "Ne shuntez jamais la protection anti-débordement ni le disjoncteur thermique.", BODY),
      PageBreak()]

# ---- p4 caractéristiques ----
E += [P("2. Caractéristiques techniques", H1),
      T([["Paramètre", "Valeur"],
         ["Alimentation secteur", "100–240 V CA, 50/60 Hz, 90 W"],
         ["Batterie interne", "12 V 2,6 Ah plomb étanche, autonomie 45 min"],
         ["Vide maximal", "−80 kPa (−600 mmHg) ± 5 %"],
         ["Débit d'air libre", "30 L/min minimum à l'entrée de pompe"],
         ["Plage du régulateur de vide", "−10 à −80 kPa, continue"],
         ["Bocal de recueil", "1,0 L polycarbonate, autoclavable à 121 °C"],
         ["Filtre antibactérien", "Hydrophobe 0,2 µm, usage unique, réf. FT-020"],
         ["Fusible", "T2AL 250 V, 5×20 mm, deux unités sur l'embase secteur"],
         ["Type de pompe", "Double membrane sans huile, moteur CC sans balais"],
         ["Facteur de service", "Continu (coupure thermique à 70 °C)"],
         ["Poids / dimensions", "4,8 kg · 330 × 210 × 240 mm"],
         ["Niveau sonore", "< 55 dB(A) à 1 m"]], widths=[65*mm, 95*mm]),
      PageBreak()]

# ---- p5 vue d'ensemble ----
E += [P("3. Vue d'ensemble de l'appareil", H1),
      P("Sous-ensembles principaux, du côté patient vers l'embase secteur :", BODY),
      T([["Rep", "Sous-ensemble", "Remarques"],
         ["A1", "Bocal de recueil avec soupape à flotteur", "Le flotteur coupe l'aspiration quand le bocal est plein (protection anti-débordement)"],
         ["A2", "Filtre antibactérien FT-020", "Entre le couvercle du bocal et l'entrée de pompe ; à remplacer s'il est mouillé ou décoloré"],
         ["A3", "Régulateur de vide et vacuomètre", "Vanne rotative ; cadran gradué en kPa et mmHg"],
         ["A4", "Tête de pompe (double membrane)", "Deux plaques à clapets, deux membranes ; kit PK-110"],
         ["A5", "Moteur BLDC et carte de commande", "Commutation par capteurs Hall ; connecteur J3, 6 broches"],
         ["A6", "Carte principale (alim + contrôle)", "Fusibles F1/F2, condensateur C4, afficheur d'erreurs"],
         ["A7", "Bloc batterie", "Connecteur J5 ; à remplacer tous les 24 mois"],
         ["A8", "Embase secteur", "IEC C14 avec interrupteur et tiroir à fusibles"]], widths=[12*mm, 58*mm, 90*mm]),
      P("Le boîtier s'ouvre par quatre vis Torx T15 situées sous les pieds en caoutchouc. La tête de "
        "pompe repose sur deux plots antivibratoires ; ne pas serrer au-delà de 0,8 N·m.", BODY),
      PageBreak()]

# ---- p6 principe ----
E += [P("4. Principe de fonctionnement", H1),
      P("Le moteur sans balais entraîne un excentrique qui fléchit deux membranes en opposition. "
        "Des clapets sur les plaques redressent le flux d'air et créent le vide à l'orifice "
        "d'entrée. La carte de commande régule la vitesse du moteur pour maintenir le vide choisi "
        "au régulateur, surveille le courant moteur, la tension batterie et la température de la "
        "tête, et signale les défauts par les codes erreur E1 à E8 sur l'afficheur.", BODY),
      P("Quand le secteur est présent, la batterie se charge à 0,4 A ; l'appareil bascule "
        "automatiquement sur batterie en cas de coupure. En cas de débordement du bocal, la soupape "
        "à flotteur obture le couvercle : le vide monte brutalement tandis que le débit s'annule — "
        "cela protège le filtre et la pompe et déclenche en général l'erreur E5 (entrée obstruée).", BODY),
      P("Le courant typique à −60 kPa est de 1,1 à 1,4 A sur le rail 12 V. Une valeur supérieure à "
        "2,0 A avec un vide faible indique un défaut mécanique de la tête de pompe (voir section 6).", BODY),
      PageBreak()]

# ---- p7 codes erreur ----
E += [P("5. Codes erreur", H1),
      P("Les codes s'affichent en face avant. Maintenez MODE 3 s pour afficher les cinq derniers "
        "codes mémorisés avec l'horodatage du compteur horaire.", BODY),
      T([["Code", "Signification", "Premières actions"],
         ["E1", "Défaut fusible secteur / secteur absent", "Contrôler les fusibles F1 et F2 (T2AL 250 V) dans le tiroir de l'embase ; vérifier cordon et prise"],
         ["E2", "Batterie faible (< 10,8 V)", "Brancher le secteur 8 h ; si E2 revient vite, tester la capacité, remplacer le bloc (durée de vie typique 24 mois)"],
         ["E3", "Blocage moteur / surintensité", "Désaccoupler l'excentrique ; si le moteur tourne librement, inspecter membranes et plaques à clapets (entrée de liquide) ; vérifier le connecteur J3"],
         ["E4", "Surchauffe de la tête de pompe (> 70 °C)", "Laisser refroidir 30 min ; nettoyer les ouïes ; vérifier le ventilateur ; vérifier les conditions d'emploi (ambiance < 40 °C)"],
         ["E5", "Entrée obstruée / pas de débit avec vide élevé", "Vider le bocal (flotteur peut-être collé) ; remplacer le filtre FT-020 s'il est mouillé ; vérifier les tubulures (pliures)"],
         ["E6", "Capteur de vide hors plage", "Vérifier le tuyau du capteur vers le port P1 (fissures) ; remise à zéro selon section 12 ; remplacer le capteur S2 si dérive > ±3 kPa"],
         ["E7", "Défaut capteur Hall / commutation", "Rebrancher J3 ; mesurer 5 V sur J3 broche 1 ; remplacer le moteur si une ligne Hall reste figée pendant la rotation manuelle"],
         ["E8", "Défaut interne carte de commande", "Un cycle d'arrêt/marche ; si E8 persiste, remplacer la carte MB-100 — pas de réparation composant sur site"]],
        widths=[12*mm, 52*mm, 96*mm]),
      PageBreak()]

# ---- p8 dépannage aspiration ----
E += [P("6. Dépannage — problèmes d'aspiration", H1),
      P("6.1 Pas d'aspiration au tuyau patient", H2),
      P("Progressez du côté patient vers la pompe : "
        "(1) Couvercle du bocal mal engagé ou joint abîmé — réinstaller, inspecter le joint G-101 ; "
        "(2) Soupape à flotteur collée après un débordement — vider le bocal, rincer le flotteur, vérifier sa liberté ; "
        "(3) Filtre antibactérien FT-020 mouillé ou colmaté — le remplacer, ne jamais le laver ; "
        "(4) Tubulure pliée ou raccords fissurés — remplacer le jeu TS-210 ; "
        "(5) Régulateur ouvert à l'atmosphère — tourner dans le sens horaire pour augmenter le vide ; "
        "(6) S'il n'y a toujours pas d'aspiration avec l'entrée bouchée au doigt et le vacuomètre à zéro : défaut de tête de pompe — voir 6.3.", BODY),
      P("6.2 Aspiration faible (vide sous −40 kPa, entrée bouchée)", H2),
      P("Causes les plus fréquentes sur le terrain : joint de bocal fuyard (remplacer G-101), tuyau "
        "silicone interne poreux entre le port filtre et l'entrée de pompe (remplacer, silicone "
        "6×9 mm), membranes usées après ~3 000 h (monter le kit PK-110). De l'eau savonneuse sur "
        "les raccords révèle les fuites par des bulles en fonctionnement. Vérifiez le vacuomètre "
        "contre un étalon avant de remplacer des pièces.", BODY),
      P("6.3 Intervention sur la tête de pompe", H2),
      P("Déposer les quatre vis M4 du couvercle de tête. Repérer l'orientation des membranes avant "
        "démontage. Inspecter les clapets (corrosion, débris) ; nettoyer les sièges à l'alcool "
        "isopropylique uniquement. Monter les membranes neuves avec les vis du kit, serrage 0,8 N·m "
        "en croix. Faire tourner 5 min puis réaliser le test de vide de la section 12.", BODY),
      PageBreak()]

# ---- p9 alim/moteur ----
E += [P("7. Dépannage — alimentation et moteur", H1),
      P("7.1 Appareil totalement mort", H2),
      P("Vérifier dans l'ordre : prise murale alimentée (lampe témoin) ; continuité du cordon ; "
        "fusibles F1/F2 dans le tiroir de l'embase — remplacer uniquement par T2AL 250 V ; "
        "continuité de l'interrupteur ; présence de 12 V au connecteur batterie J5 (batterie "
        "profondément déchargée possible — l'appareil peut fonctionner sur secteur batterie "
        "débranchée pour le diagnostic). Un fusible qui refond immédiatement indique un redresseur "
        "en court-circuit sur la carte principale ou un moteur bloqué — ne pas remplacer les "
        "fusibles en boucle.", BODY),
      P("7.2 Fonctionne sur secteur mais pas sur batterie", H2),
      P("Mesurer la tension batterie à vide : sous 11,5 V après 8 h de charge, le bloc est usé — "
        "le remplacer (réf. BT-126). Contrôler le fusible à lame 3 A du câble batterie. Si le "
        "voyant de charge ne s'allume jamais, mesurer 13,8 V sur J5 secteur branché ; absent → "
        "défaut du chargeur sur la carte principale.", BODY),
      P("7.3 Le moteur démarre puis s'arrête (souvent avec E3)", H2),
      P("L'entrée de liquide gomme la tête de pompe : déposer le couvercle et vérifier la présence "
        "de liquide. Tourner l'excentrique à la main — il doit tourner librement. Vérifier le "
        "verrouillage du connecteur J3 (les vibrations le desserrent). Mesurer la résistance des "
        "phases moteur : 0,8 à 1,2 Ω entre deux broches de phase ; enroulement coupé ou en "
        "court-circuit → remplacer le moteur MT-100.", BODY),
      PageBreak()]

# ---- p10 surchauffe/bruit ----
E += [P("8. Dépannage — surchauffe et bruit", H1),
      P("8.1 Surchauffe / E4 répétés", H2),
      P("Dépoussiérer les ouïes et le ventilateur à la brosse sèche. Vérifier que le ventilateur "
        "tourne au-delà de −30 kPa de charge. Contrôler la température ambiante et l'absence de "
        "confinement (placard). Une tête remontée sans les plots antivibratoires, ou un "
        "fonctionnement continu au vide maximal au-delà de 40 °C ambiants, fera cycler la coupure "
        "thermique — c'est une protection, pas une panne.", BODY),
      P("8.2 Bruit ou vibrations excessifs", H2),
      P("Cliquetis : vis de boîtier desserrées ou plots antivibratoires fissurés (remplacer par "
        "paire, réf. AV-014). Cognement à vide faible : roulement d'excentrique usé — remplacer "
        "avec le kit PK-110. Sifflement aigu : battement de clapet, généralement un débris sur un "
        "siège — nettoyer selon 6.3. Après toute réparation de bruit, faire tourner à −60 kPa "
        "pendant 10 minutes et vérifier que la tête reste sous 60 °C.", BODY),
      P("8.3 Afficheur éteint mais pompe fonctionnelle", H2),
      P("Rebrancher la nappe de l'afficheur sur J7. S'il manque des segments, remplacer le module "
        "DP-100 ; l'appareil reste utilisable à court terme — le vide reste régulé mécaniquement.", BODY),
      PageBreak()]

# ---- p11 maintenance préventive ----
E += [P("9. Calendrier de maintenance préventive", H1),
      T([["Périodicité", "Tâche", "Pièces"],
         ["Quotidien (utilisateur)", "Vider et désinfecter le bocal ; vérifier filtre sec ; tester l'aspiration doigt sur l'entrée", "—"],
         ["Mensuel", "Inspecter tubulures et joint de couvercle ; nettoyer les ouïes ; tester l'autonomie batterie ≥ 30 min", "G-101 si abîmé"],
         ["6 mois", "Test de vide (section 12) ; contrôler le tiroir à fusibles ; vérifier la liberté du flotteur", "—"],
         ["12 mois", "Rotation du stock de filtres ; test de capacité batterie ; test de sécurité électrique (limites de fuite classe II)", "FT-020"],
         ["24 mois", "Remplacer le bloc batterie ; remplacer le jeu de joints du bocal ; envisager le kit membranes si > 3 000 h", "BT-126, G-101, PK-110"]],
        widths=[26*mm, 92*mm, 42*mm]),
      P("Consignez chaque intervention dans votre journal de maintenance avec la date, le compteur "
        "horaire et les pièces utilisées. Sur le terrain, les appareils au journal complet montrent "
        "environ moitié moins d'arrêts imprévus que les appareils non suivis.", BODY),
      PageBreak()]

# ---- p12 nettoyage ----
E += [P("10. Nettoyage et désinfection", H1),
      P("Bocal, couvercle et flotteur : laver à l'eau chaude avec détergent, puis désinfecter "
        "(chlore 0,5 % pendant 10 min ou autoclave 121 °C / 15 min — bocal polycarbonate "
        "uniquement, surveiller le faïençage après cycles répétés). Les tubulures sont à patient "
        "unique quand l'approvisionnement le permet ; sinon désinfection chimique, jamais "
        "d'autoclave sur tubulure PVC.", BODY),
      P("Boîtier : essuyer à l'alcool isopropylique 70 %. Ne jamais pulvériser de liquide vers les "
        "ouïes. Le filtre antibactérien FT-020 ne se nettoie pas et ne se réutilise pas : mouillé, "
        "il bloque le débit (E5) et perd sa fonction de barrière.", BODY),
      P("Avant d'ouvrir l'appareil : faire tourner 30 s avec un bocal de désinfectant raccordé, "
        "essuyer les surfaces externes, porter des gants pendant toute l'intervention.", BODY),
      PageBreak()]

# ---- p13 pièces ----
E += [P("11. Pièces détachées", H1),
      T([["Réf.", "Désignation", "Remplacement typique"],
         ["FT-020", "Filtre antibactérien 0,2 µm hydrophobe", "Si mouillé/décoloré ; rotation de stock 12 mois"],
         ["G-101", "Joint de couvercle de bocal, silicone", "Si abîmé ; tous les 24 mois"],
         ["TS-210", "Jeu de tubulures côté patient, 2 m", "Si abîmé ou selon politique d'hygiène"],
         ["PK-110", "Kit pompe : 2 membranes, 2 plaques à clapets, vis", "~3 000 h ou après entrée de liquide"],
         ["BT-126", "Batterie 12 V 2,6 Ah plomb étanche", "24 mois"],
         ["MT-100", "Moteur BLDC avec capteurs Hall", "Si enroulement/Hall défectueux"],
         ["MB-100", "Carte principale (alim + contrôle)", "Si E8 persistant"],
         ["DP-100", "Module afficheur", "Si affichage défaillant"],
         ["AV-014", "Plots antivibratoires (paire)", "Si fissurés/bruit"],
         ["FU-T2A", "Fusible T2AL 250 V 5×20 mm (×10)", "Selon besoin — chercher la cause des claquages répétés"]],
        widths=[22*mm, 84*mm, 54*mm]),
      P("Équivalents génériques : le fusible, le tuyau silicone (6×9 mm) et la batterie plomb sont "
        "des pièces standard disponibles sur la plupart des marchés ; respecter exactement les "
        "caractéristiques.", BODY),
      PageBreak()]

# ---- p14 étalonnage ----
E += [P("12. Test de vide et étalonnage", H1),
      P("12.1 Test de performance (après chaque réparation)", H2),
      P("(1) Monter un bocal propre, un filtre sec, fermer l'entrée avec le bouchon de test. "
        "(2) Fonctionnement au maximum : le vacuomètre doit atteindre −75 kPa ou mieux en 10 s. "
        "(3) Arrêter la pompe : le vide ne doit pas chuter de plus de 5 kPa en 60 s (test "
        "d'étanchéité). (4) Régler à −30 kPa : la valeur doit tenir ± 3 kPa pendant 5 min. "
        "(5) Débit libre : entrée ouverte, un bocal d'1 L d'eau élevée de 0,5 m se remplit en "
        "moins de 25 s (≈ 30 L/min équivalent air).", BODY),
      P("12.2 Remise à zéro du capteur de vide", H2),
      P("Appareil éteint, entrée ouverte à l'atmosphère, maintenir MODE + MARCHE 5 s jusqu'à "
        "l'affichage « CAL », puis appuyer une fois sur MODE. L'afficheur indique « 0.0 ». Si E6 "
        "persiste après la remise à zéro, remplacer le capteur S2 sur la carte principale (pièce "
        "enfichable, sans soudure).", BODY),
      P("12.3 Sécurité électrique", H2),
      P("Après toute ouverture du boîtier : test de courant de contact classe II selon votre norme "
        "locale (limites IEC 62353). Consigner les résultats dans le journal de maintenance.", BODY),
      Spacer(1, 8*mm),
      P("— Fin du manuel de démonstration. Appareil fictif, contenu original, créé pour le projet Taller. —", SMALL)]

doc.build(E)
print("écrit", OUT)
