#!/usr/bin/env tsx
/**
 * Script d'analyse des performances de base de données
 *
 * Ce script analyse le schéma Prisma et les requêtes pour identifier:
 * - Les indexes manquants
 * - Les requêtes potentiellement lentes
 * - Les opportunités d'optimisation
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

interface IndexAnalysis {
  model: string;
  fields: string[];
  usage: string[];
  recommended: boolean;
}

interface QueryAnalysis {
  pattern: string;
  frequency: number;
  potentialIssues: string[];
  recommendations: string[];
}

/**
 * Analyse le schéma Prisma pour identifier les indexes manquants
 */
function analyzeSchema(): IndexAnalysis[] {
  const schemaPath = path.join(process.cwd(), 'apps/backend/prisma/schema.prisma');
  const schemaContent = fs.readFileSync(schemaPath, 'utf-8');

  const analyses: IndexAnalysis[] = [];
  const modelMatches = schemaContent.matchAll(/model (\w+) \{([^}]+)\}/gs);

  for (const match of modelMatches) {
    const modelName = match[1];
    const modelContent = match[2];

    // Vérifier les champs avec @unique ou @@unique
    const uniqueFields = [
      ...modelContent.matchAll(/^\s+(\w+)\s+.*@unique/gm),
      ...modelContent.matchAll(/@@unique\(\[([^\]]+)\]/g),
    ].map((m) => m[1] || m[2]);

    // Vérifier les relations (foreign keys)
    const relationFields = [...modelContent.matchAll(/^\s+(\w+)\s+.*@relation/gm)].map((m) => m[1]);

    // Vérifier les champs fréquemment filtrés (userId, competitionId, etc.)
    const filterFields = [...modelContent.matchAll(/^\s+(\w+Id)\s+/gm)].map((m) => m[1]);

    // Vérifier les indexes existants
    const existingIndexes = [...modelContent.matchAll(/@@index\(\[([^\]]+)\]/g)].map((m) =>
      m[1].split(',').map((f) => f.trim().replace(/"/g, '')),
    );

    const allFields = [...new Set([...uniqueFields, ...relationFields, ...filterFields])];

    // Identifier les champs qui devraient avoir un index mais n'en ont pas
    const fieldsNeedingIndex = allFields.filter((field) => {
      return !existingIndexes.some((index) => index.some((idxField) => idxField === field));
    });

    if (fieldsNeedingIndex.length > 0) {
      analyses.push({
        model: modelName,
        fields: fieldsNeedingIndex,
        usage: ['filtering', 'joins', 'foreign keys'],
        recommended: true,
      });
    }
  }

  return analyses;
}

/**
 * Analyse les patterns de requêtes dans le code
 */
function analyzeQueryPatterns(): QueryAnalysis[] {
  const srcPath = path.join(process.cwd(), 'apps/backend/src');
  const analyses: QueryAnalysis[] = [];
  const queryPatterns = new Map<string, number>();

  // Rechercher les patterns de requêtes Prisma
  function findQueries(dir: string) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      if (file.isDirectory()) {
        findQueries(fullPath);
      } else if (file.name.endsWith('.ts') && !file.name.endsWith('.spec.ts')) {
        const content = fs.readFileSync(fullPath, 'utf-8');

        // Trouver les requêtes findMany, findUnique, etc.
        const findManyMatches = content.matchAll(/\.findMany\([\s\S]*?\)/g);
        for (const match of findManyMatches) {
          const pattern = match[0].substring(0, 100);
          queryPatterns.set(pattern, (queryPatterns.get(pattern) || 0) + 1);
        }

        // Trouver les requêtes avec includes (potentielles N+1)
        const includeMatches = content.matchAll(/include:\s*\{[^}]+\}/g);
        for (const match of includeMatches) {
          const pattern = `include: ${match[0].substring(0, 50)}`;
          queryPatterns.set(pattern, (queryPatterns.get(pattern) || 0) + 1);
        }
      }
    }
  }

  findQueries(srcPath);

  // Analyser les patterns trouvés
  for (const [pattern, frequency] of queryPatterns.entries()) {
    const potentialIssues: string[] = [];
    const recommendations: string[] = [];

    // Détecter les problèmes potentiels
    if (pattern.includes('findMany') && !pattern.includes('select')) {
      potentialIssues.push('Missing select - fetching all fields');
      recommendations.push('Use select to fetch only needed fields');
    }

    if (pattern.includes('include') && frequency > 5) {
      potentialIssues.push('Potential N+1 query pattern');
      recommendations.push('Consider using select instead of include');
    }

    if (pattern.includes('findMany') && !pattern.includes('take')) {
      potentialIssues.push('No pagination limit');
      recommendations.push('Add take() or pagination to limit results');
    }

    analyses.push({
      pattern,
      frequency,
      potentialIssues,
      recommendations,
    });
  }

  return analyses.sort((a, b) => b.frequency - a.frequency);
}

/**
 * Génère un rapport d'analyse
 */
function generateReport(indexAnalyses: IndexAnalysis[], queryAnalyses: QueryAnalysis[]): string {
  let report = '# Analyse des Performances de Base de Données\n\n';
  report += `Date: ${new Date().toISOString()}\n\n`;

  // Section Indexes
  report += '## 📊 Analyse des Indexes\n\n';
  if (indexAnalyses.length === 0) {
    report += '✅ Tous les modèles ont des indexes appropriés.\n\n';
  } else {
    report += `⚠️ ${indexAnalyses.length} modèle(s) nécessitent des indexes supplémentaires:\n\n`;
    indexAnalyses.forEach((analysis) => {
      report += `### ${analysis.model}\n\n`;
      report += `**Champs recommandés pour index:**\n`;
      analysis.fields.forEach((field) => {
        report += `- \`${field}\`\n`;
      });
      report += `\n**Usage:** ${analysis.usage.join(', ')}\n\n`;
      report += `**Recommandation:** Ajouter un index composite si nécessaire\n\n`;
    });
  }

  // Section Requêtes
  report += '## 🔍 Analyse des Patterns de Requêtes\n\n';
  if (queryAnalyses.length === 0) {
    report += '✅ Aucun pattern de requête problématique détecté.\n\n';
  } else {
    report += `📋 ${queryAnalyses.length} pattern(s) de requête analysé(s):\n\n`;
    queryAnalyses.slice(0, 20).forEach((analysis) => {
      report += `### Pattern (fréquence: ${analysis.frequency})\n\n`;
      report += `\`\`\`typescript\n${analysis.pattern}\n\`\`\`\n\n`;
      if (analysis.potentialIssues.length > 0) {
        report += `**Problèmes potentiels:**\n`;
        analysis.potentialIssues.forEach((issue) => {
          report += `- ⚠️ ${issue}\n`;
        });
        report += '\n';
      }
      if (analysis.recommendations.length > 0) {
        report += `**Recommandations:**\n`;
        analysis.recommendations.forEach((rec) => {
          report += `- 💡 ${rec}\n`;
        });
        report += '\n';
      }
    });
  }

  // Recommandations générales
  report += '## 💡 Recommandations Générales\n\n';
  report += '1. **Utiliser `select` au lieu de récupérer tous les champs**\n';
  report += '2. **Ajouter des indexes sur les foreign keys**\n';
  report += '3. **Implémenter la pagination** pour les listes\n';
  report += '4. **Éviter les N+1 queries** avec des includes appropriés\n';
  report += '5. **Utiliser le cache Redis** pour les données fréquemment accédées\n';
  report += '6. **Monitorer les requêtes lentes** avec MetricsService\n';
  report += '7. **Utiliser des transactions** pour les opérations multiples\n';
  report += '8. **Optimiser les relations** avec des selects spécifiques\n\n';

  return report;
}

async function main() {
  console.log('🔍 Analyse des performances de base de données...\n');

  const indexAnalyses = analyzeSchema();
  console.log(`✓ Analyse du schéma: ${indexAnalyses.length} modèle(s) nécessitent des indexes`);

  const queryAnalyses = analyzeQueryPatterns();
  console.log(`✓ Analyse des requêtes: ${queryAnalyses.length} pattern(s) trouvé(s)`);

  const report = generateReport(indexAnalyses, queryAnalyses);

  // Écrire le rapport
  const reportPath = path.join(process.cwd(), 'DB_PERFORMANCE_ANALYSIS.md');
  fs.writeFileSync(reportPath, report, 'utf-8');

  console.log(`\n📄 Rapport généré: ${reportPath}\n`);
  console.log(report);
}

main().catch((error) => {
  console.error("❌ Erreur lors de l'analyse:", error);
  process.exit(1);
});
