DOSSIER MAÎTRE DE PROJET : "FFD CONNECT"

PROPOSITION DE DÉVELOPPEMENT & SPÉCIFICATIONS

MÉTADONNÉES DU DOCUMENT



Projet

Écosystème Mobile Fédéral & Plateforme de Services

Maîtrise d'Ouvrage (Client)

Fédération Française de Danse (FFD)

Maîtrise d'Œuvre (Réalisation)

Gabin SIMOND (Lead Developer & Chef de Projet)

Version

2.5 - Version Finale (Prête pour validation)

Date

13 Janvier 2026

Classification

Confidentiel - Usage Interne FFD

SOMMAIRE

0. RÉSUMÉ OPÉRATIONNEL (EXECUTIVE SUMMARY)

VISION, OBJECTIFS & ANALYSE STRATÉGIQUE

ANALYSE DES BESOINS UTILISATEURS

SPÉCIFICATIONS DÉTAILLÉES (MOBILE & WEB ADMIN)

ARCHITECTURE TECHNIQUE, SÉCURITÉ & ACCESSIBILITÉ

ORGANISATION, QUALITÉ & GOUVERNANCE

ANALYSE FINANCIÈRE & OFFRE DE SERVICE

CADRE JURIDIQUE & PROPRIÉTÉ INTELLECTUELLE

STRATÉGIE D'ADOPTION & MAINTENANCE

GLOSSAIRE TECHNIQUE & MÉTIER

VALIDATION & APPROBATION

NOTE PRÉLIMINAIRE : CADRE DE LA PROPOSITION

AVERTISSEMENT

Ce document constitue une proposition formelle établie par Gabin SIMOND. Il a pour vocation de servir de base de travail et de réflexion stratégique pour la Fédération.

Bien que les spécifications techniques et les estimations financières présentées soient détaillées pour démontrer la faisabilité et le sérieux de la démarche, l'ensemble de ce dossier (périmètre fonctionnel, choix technologiques, planning, modalités financières) est une proposition ouverte.

Tous les éléments sont discutables et ajustables afin de s'aligner parfaitement avec les priorités politiques et les contraintes budgétaires de la Fédération Française de Danse.

0. RÉSUMÉ OPÉRATIONNEL (EXECUTIVE SUMMARY)

En Bref

Le projet "FFD Connect" vise à doter la Fédération Française de Danse de sa propre application mobile souveraine. Conçue par un ingénieur-danseur, elle répond à l'urgence de dématérialiser la licence tout en offrant des services modernes (Musique, Résultats Live) pour fidéliser les adhérents.

Les 3 Piliers de Valeur

Modernisation Administrative : Fin des certificats papier, QR Code d'entrée sécurisé, renouvellement en 1 clic.

Service au Licencié : Outil d'entraînement musical pro et gestion du stress en compétition (horaires en temps réel).

Maîtrise des Coûts : Une approche de développement interne ("In-House") permettant d'économiser ~60% par rapport à une agence classique, tout en garantissant l'exclusivité d'usage à la FFD.

L'Offre Financière (Synthèse)

Investissement (Build) : ~28.5 k€ (Forfaitaire).

Maintenance (Run) : ~950 €/mois (MCO & Astreintes).

Planning : MVP (Version 1) livrable sous 3 mois.

1. VISION, OBJECTIFS & ANALYSE STRATÉGIQUE

1.1. Contexte & Problématique

La Fédération Française de Danse gère des milliers de licenciés mais souffre d'un déficit d'outils numériques mobiles.

Administratif : La licence est physique/PDF, le renouvellement est lourd, les contrôles en compétition sont manuels.

Sportif : Les danseurs utilisent des outils tiers (YouTube, Spotify) mal adaptés pour s'entraîner.

Information : Règlements et résultats sont dispersés et difficiles d'accès sur le terrain.

1.2. La Solution "FFD Connect"

Ce projet propose une application souveraine, développée en interne, pour :

Dématérialiser l'identité et le contrôle d'accès.

Accompagner le danseur au quotidien (Musique, Recherche partenaire).

Moderniser l'image fédérale auprès des jeunes générations.

1.3. Profil & Expertise du Porteur de Projet

Ce projet s'appuie sur le parcours professionnel solide de Gabin SIMOND :

Ingénieur du Numérique Diplômé : Rigueur architecturale et sécurité.

Prestataire de Services Informatiques (Depuis 2019) : Expérience de la relation client et des livrables.

Consultant Intégration (Secteur Éducation & Formation) : Salarié chez un éditeur logiciel leader. Maîtrise des enjeux institutionnels, RGPD et bases de données à fort volume.

1.4. Analyse SWOT du Projet (Matrice Stratégique)

FORCES (Strengths)

FAIBLESSES (Weaknesses)

- Expertise métier "Danseur" + "Ingénieur".



- Coût maîtrisé (Développement interne).



- Souveraineté des données (Pas de SAAS tiers).



- Fonctionnalités exclusives (Audio Pitch, WDSF).

- Dépendance à un Lead Developer unique (Risque "Bus Factor").



(Mitigation : Documentation stricte & Open Source interne).

OPPORTUNITÉS (Opportunities)

MENACES (Threats)

- Image moderne auprès des jeunes (Gen Z).



- Valorisation de la licence (Service tangible).



- Réduction empreinte carbone (Dématérialisation).



- Fidélisation via les outils communautaires.

- Résistance au changement (Clubs conservateurs).



- Instabilité des réseaux dans certains gymnases.



(Mitigation : Mode Offline-First natif).

2. ANALYSE DES BESOINS UTILISATEURS

2.1. Cibles

Le Compétiteur : Veut prouver son identité, gérer son stress (timing) et s'entraîner efficacement.

L'Organisateur : Veut fluidifier les entrées (scan) et communiquer les retards.

Le Danseur Loisir : Cherche un partenaire ou un club.

La Fédération : Veut des données fiables et un canal de communication direct.

2.2. Parcours Utilisateurs Clés

"Je veux renouveler ma licence en prenant mon certificat médical en photo."

"Je veux savoir à quelle heure je passe exactement sur la piste."

"Je veux ralentir cette musique de Tango de 5% pour travailler ma technique."

"Je veux voir si mes points me permettent de passer au niveau Avancé."

3. SPÉCIFICATIONS DÉTAILLÉES (MOBILE & WEB ADMIN)

Cette section détaille l'implémentation technique de chaque module fonctionnel.

3.1. Module Administratif : Identité, Sécurité & WDSF

Objectifs du Module :

Dématérialiser totalement la carte de licence pour réduire les coûts d'impression et d'envoi.

Simplifier le processus annuel de renouvellement pour soulager les clubs.

Unifier l'identité nationale (FFD) et internationale (WDSF).

Fonctionnalités Clés :

E-Licence (Portefeuille) : Affichage instantané du QR Code avec indicateur visuel de validité (Vert/Rouge) et fonctionnement hors-ligne garanti.

Renouvellement "One-Tap" : Formulaire pré-rempli avec les données N-1.

Scanner de Documents : Prise de photo des certificats médicaux avec recadrage automatique et envoi sécurisé.

Extension WDSF : Importation du profil international et affichage de la e-Card WDSF (RLS) dans le même portefeuille.

Implémentation Technique :

Authentification : Utilisation OAuth2 / OpenID Connect et JWT.

Sécurisation du QR Code : Signature RSA256, régénération TOTP (Anti-screenshot).

Traitement OCR : Google ML Kit (On-device) pour extraction données certificat.

Intégration WDSF : Appel API REST worlddancesport.org et cache local.

3.2. Module Sportif : Moteur Audio & DSP

Objectifs du Module :

Fournir un outil d'entraînement quotidien justifiant le prix de la licence.

Rendre le danseur autonome dans sa préparation physique et technique.

Fonctionnalités Clés :

Lecteur Dédié : Support des playlists locales (MP3, WAV) du danseur.

Contrôle du Tempo (Pitch) : Possibilité de ralentir ou accélérer la musique (-30% à +30%) sans déformer la voix ("Mickey effect"), idéal pour la technique.

Mode Simulation Compétition : Création de scénarios automatisés (ex: 5 danses latines, 1min30 chacune, 15s de pause) avec fading automatique.

Implémentation Technique :

Moteur Audio : Pont natif C++ (Oboe/AVAudioEngine).

DSP : Librairie SoundTouch pour Time-Stretching temps réel.

Base locale : SQLite pour indexation playlists.

3.3. Module Compétition : Architecture Temps Réel

Objectifs du Module :

Réduire le stress des compétiteurs lié à l'incertitude des horaires.

Digitaliser l'expérience "Jour J" de l'inscription à la finale.

Fonctionnalités Clés :

Inscription Simplifiée : Proposition uniquement des compétitions correspondant au profil (âge/niveau). Inscription en 1 clic.

Live Timing : Affichage en temps réel du "Heat" en cours sur la piste et estimation de l'heure de passage personnalisée.

Résultats Push : Notification instantanée dès la qualification ("Vous passez au tour suivant") et accès aux détails des marques (Skating).

Implémentation Technique :

Temps Réel : WebSockets (Socket.io) avec architecture "Rooms".

Notifications : Firebase Cloud Messaging (FCM) High Priority.

Algorithme : Implémentation Node.js du Skating System (Rule 11).

3.4. Module Carrière : Big Data & Indexation

Objectifs du Module :

Centraliser l'historique sportif du licencié.

Clarifier les règlements complexes (tenues, points).

Fonctionnalités Clés :

Palmarès : Historique complet des compétitions, classements et points acquis.

Suivi de Progression : Jauge visuelle des points restants pour la montée de niveau ou la qualification aux Championnats de France.

Règlements Intelligents : Moteur de recherche filtrant les règles par catégorie (ex: "Tenues autorisées Junior I").

Implémentation Technique :

Data : PostgreSQL partitionné.

Recherche : Full-Text Search (TSVECTOR) sur règlements tagués.

3.5. Module Communautaire : Géolocalisation & Chat

Objectifs du Module :

Réduire le taux d'abandon lié à la perte de partenaire.

Favoriser l'éco-responsabilité et l'entraide.

Fonctionnalités Clés :

Bourse aux Partenaires : Matching sécurisé (réservé aux licenciés) par niveau, taille et géographie.

Covoiturage Événementiel : Mise en relation des danseurs d'une même région se rendant à la même compétition.

Vide-Dressing : Espace de revente de matériel d'occasion certifié.

Implémentation Technique :

Géo : PostGIS + Geohashing (Privacy).

Chat : Firestore NoSQL.

3.6. Portail d'Administration Web (Back-Office Fédéral)

Objectifs du Module :

Offrir à la FFD un outil de pilotage et de communication directe.

Fonctionnalités Clés :

Dashboard Analytique : Carte de chaleur, statistiques d'usage.

Centre de Notification : Envoi de Push ciblés par région ou discipline.

Modération : Validation manuelle des certificats rejetés par l'IA.

4. ARCHITECTURE TECHNIQUE, SÉCURITÉ & ACCESSIBILITÉ

4.1. Schéma d'Architecture

graph TD
    User[Smartphone Danseur] -- HTTPS / TLS 1.3 --> LB[Load Balancer]
    Admin[Admin FFD Web] -- HTTPS --> LB
    
    subgraph "Infrastructure Cloud (Souveraine)"
        LB --> API_Core[API Core System\n(NestJS)]
        LB --> API_Stream[Serveur WebSocket\n(Live Timing)]
        
        API_Core --> DB[(PostgreSQL\nDonnées Métier)]
        API_Stream --> Redis[(Redis Cache\nTemps Réel)]
        
        API_Core -- Stockage Chiffré --> S3[Coffre-fort Documents]
    end
    
    subgraph "Intégrations Externes"
        API_Core -- REST --> FFD_Legacy[SI Fédéral (Extranet)]
        API_Core -- REST --> WDSF[API Monde]
        Scrutelle[Logiciel Compétition] -- Push Data --> API_Stream
    end


4.2. Stack & Sécurité

Stack : React Native / NestJS / PostgreSQL / Redis.

RGPD : Consentement mineurs, Chiffrement Santé (AES-256), TLS 1.3.

4.3. Sobriété Numérique & Accessibilité (RGAA)

Le projet s'inscrit dans une démarche citoyenne :

Green IT : Dark Mode Natif (économie batterie OLED), Offline First (réduction requêtes), Compression images.

Accessibilité Numérique (RGAA) : Engagement de conformité au Référentiel Général d'Amélioration de l'Accessibilité.

Compatibilité avec les lecteurs d'écran (TalkBack/VoiceOver) pour les danseurs malvoyants.

Contrastes élevés et typographies adaptables.

5. ORGANISATION, QUALITÉ & GOUVERNANCE

5.1. Méthodologie & Comitologie

Le projet suit une méthode Agile structurée pour garantir la visibilité de la FFD.

COPIL (Comité de Pilotage) : Fréquence Mensuelle.

Participants : Gabin S., Référent FFD (Élu), DG FFD.

Ordre du jour : Validation des jalons, Budget, Arbitrages stratégiques.

COPTECH (Comité Technique) : Fréquence : Bi-mensuelle.

Participants : Gabin S., DSI ou Référent Technique FFD.

Ordre du jour : Avancement dev, Tests, Validation UX/UI.

5.2. Protocole de Recette (Validation)

Avant chaque mise en production, une phase de Recette Utilisateur (UAT) est déclenchée :

Cahier de Recette : Fourniture d'un plan de test détaillé ("Scénario : Inscription d'un mineur").

Environnement de "Staging" : Une version de l'app iso-prod est mise à disposition des élus FFD pour tester sans impacter les vraies données.

PV de Recette : Validation formelle signée par la FFD autorisant le déploiement (Go/No-Go).

5.3. Planning & Roadmap

Phase

Durée Estimée

Livrables Clés

Phase 1 : Conception

M0 à M+1

Maquettes UI/UX, Architecture Audio, Proto QR Code.

Phase 2 : MVP

M+1 à M+3

App iOS/Android, Connexion, E-Licence, Lecteur Audio.

Phase 3 : Admin

M+3 à M+4

Renouvellement, OCR, WDSF, Back-Office.

Phase 4 : Live

M+4 à M+6

Compétition, Live Timing, Résultats.

Phase 5 : Communauté

M+6 à M+7

Partenaires, Règlements, Covoiturage.

Lancement

M+8

Déploiement Stores.

5.4. Formation & Accompagnement

Kit de Communication et Webinaires de Formation pour les comités régionaux.

6. ANALYSE FINANCIÈRE & OFFRE DE SERVICE

NOTE DE TRANSPARENCE

Chiffres donnés à titre indicatif pour base de négociation.

6.1. Comparatif Marché (Agence)

Estimation Agence ESN : ~ 70 250 € HT (115 Jours/Homme).

6.2. Proposition Partenariale (Gabin SIMOND)

A. Investissement Initial (Build)

Tarif Forfaitaire : 28 500 € HT (Économie ~60%).

B. Maintenance (Run)

Tarif Mensuel : 950 € HT / mois (MCO, Updates OS, Astreinte Serveur).

6.3. OPEX (Coûts Tiers FFD)

Infra Cloud : ~150€/mois (Scalable).

Licences Stores : ~100€/an.

7. CADRE JURIDIQUE & PROPRIÉTÉ INTELLECTUELLE

7.1. Propriété des Sources & Licence d'Exploitation

Propriété Intellectuelle (IP) : Gabin SIMOND conserve la propriété pleine et entière du code source, de l'architecture logicielle et des algorithmes.

Licence Exclusive d'Exploitation : La FFD bénéficie d'une licence d'utilisation exclusive, perpétuelle et mondiale sur le territoire français. Gabin SIMOND s'interdit de revendre cette solution à une structure concurrente directe.

7.2. Continuité de Service (Garantie de Pérennité)

Accès au Code Source : Dépôt des sources sur un Git privé accessible à la FFD (Lecture seule / Séquestre).

Clause de Réversibilité : Droit de maintenance par un tiers en cas de défaillance majeure du prestataire.

8. STRATÉGIE D'ADOPTION & MAINTENANCE

8.1. Plan de Lancement

Soft Launch (Pilote) : Test sur une compétition majeure.

Campagne "QR Bib" : QR Code résultats sur dossards.

Ambassadeurs : Promotion par Top Athlètes.

8.2. Indicateurs de Succès (KPIs)

Taux de pénétration : % licenciés actifs.

Dématérialisation : -80% papier au siège.

9. GLOSSAIRE TECHNIQUE & MÉTIER

Pour faciliter la lecture de ce dossier technique :

API (Application Programming Interface) : Connecteur permettant à deux logiciels (l'App et la Base Fédérale) de dialoguer de manière sécurisée.

Back-Office : Interface d'administration réservée aux gestionnaires (FFD) pour piloter l'application, invisible pour le grand public.

DSP (Digital Signal Processing) : Traitement numérique du signal. Technologie utilisée ici pour modifier la vitesse de la musique sans déformer la voix (Time Stretching).

MCO (Maintien en Condition Opérationnelle) : Ensemble des actions de maintenance (correctifs, mises à jour) garantissant que l'application reste fonctionnelle dans le temps.

MVP (Minimum Viable Product) : Première version de l'application contenant uniquement les fonctionnalités essentielles pour un lancement rapide.

Offline-First : Architecture logicielle permettant à l'application de fonctionner normalement même sans connexion internet (ex: au fond d'un gymnase).

RGAA : Référentiel Général d'Amélioration de l'Accessibilité. Normes obligatoires pour rendre les services numériques accessibles aux personnes en situation de handicap.

Skating System : Système de notation officiel en danse sportive (Règle 11) permettant de classer les couples selon la majorité des juges.

WDSF : World DanceSport Federation (Fédération Internationale).

10. VALIDATION & APPROBATION

Pour la Fédération Française de Danse (FFD)
Nom du Signataire :
Date :

(Signature et Cachet)

Pour le Maître d'Œuvre (Gabin SIMOND)
Date :

(Signature)

Tous droits réservés à Gabin SIMOND - SIREN 880 961 198