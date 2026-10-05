# Patterns Utilisés dans FFD Connect

Ce document décrit en détail les patterns architecturaux utilisés dans le projet FFD Connect.

## Structure du monorepo

Le projet est un monorepo pnpm workspaces :

```
FFD-Connect/
├── apps/
│   ├── backend/          # API NestJS 11
│   ├── client/           # Application React Native (Expo ~57)
│   ├── landing/          # Page d'accueil (Vite/React)
│   └── docs/             # Documentation (Astro/Starlight)
├── packages/
│   ├── shared/           # Types partagés
│   ├── eslint-config/    # Config ESLint partagée
│   └── jest-config/      # Config Jest partagée
└── scripts/              # Scripts utilitaires
```

**Avantages :** partage de code (types) entre backend et client, gestion centralisée des dépendances, builds et tests coordonnés.

Le backend suit une architecture modulaire NestJS : chaque domaine (auth, competitions, clubs, licenses, tracks, etc.) est un module avec contrôleurs et services, ces derniers décomposés par responsabilité (QueryService pour les lectures, Service pour les écritures). Le client est organisé par features sous `src/features/`.

## Repository Pattern

### Description

Le Repository Pattern abstrait l'accès aux données et fournit une interface uniforme pour accéder aux données, indépendamment de la source (API, base de données, cache, etc.).

### Implémentation dans FFD Connect

#### Mobile: AuthContext

```typescript
// Interface du repository
interface AuthRepository {
  login(email: string, password: string): Promise<AuthResult>;
  logout(): Promise<void>;
  getCurrentUser(): Promise<User | null>;
  refreshToken(): Promise<string | null>;
}

// Implémentation concrète avec appels API
class AuthService implements AuthRepository {
  async login(email: string, password: string): Promise<AuthResult> {
    const response = await api.post('/auth/login', { email, password });
    return response.data;
  }
  // ...
}

// Utilisation dans le Context
export const AuthProvider = ({
  implementation
}: {
  implementation: AuthRepository
}) => {
  const [user, setUser] = useState<User | null>(null);

  const login = async (email: string, password: string) => {
    const result = await implementation.login(email, password);
    setUser(result.user);
    return result;
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
```

**Avantages:**

- ✅ Facilite les tests (mock du repository)
- ✅ Découple la logique métier de l'implémentation
- ✅ Permet de changer d'implémentation facilement
- ✅ Facilite la migration vers d'autres sources de données

**Utilisation:**

- `AuthContext` utilise `AuthService` comme implémentation
- `ClubContext` utilise `defaultClubRepository` comme implémentation
- `TrackContext` utilise `TrackService` comme implémentation

## Dependency Injection (Backend)

### Description

NestJS utilise l'injection de dépendances pour gérer les dépendances entre les modules et les services.

### Implémentation dans FFD Connect

```typescript
// Service avec injection de dépendances
@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, pass: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    // ...
  }
}

// Module qui fournit les dépendances
@Module({
  imports: [PrismaModule, JwtModule],
  providers: [AuthService],
  controllers: [AuthController],
})
export class AuthModule {}
```

**Avantages:**

- ✅ Découplage des dépendances
- ✅ Facilite les tests (injection de mocks)
- ✅ Gestion automatique du cycle de vie
- ✅ Architecture modulaire

## Context API Pattern (Mobile)

### Description

React Context API permet de partager des données entre composants sans prop drilling.

### Implémentation dans FFD Connect

```typescript
// Création du context
const AuthContext = createContext<AuthContextValue | null>(null);

// Hook pour utiliser le context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

// Provider avec logique métier
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const result = await authService.login(email, password);
      setUser(result.user);
      return result;
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
```

**Contexts disponibles:**

- `AuthContext`: Authentification et utilisateur
- `ThemeContext`: Thème de l'application (dark/light)
- `CompetitionContext`: Compétitions
- `LibraryContext`: Bibliothèque de musiques
- `PlayerContext`: Lecteur audio
- `PerformanceContext`: Performances
- `ClubContext`: Gestion des clubs
- `TrackContext`: Gestion des pistes

## Custom Hooks Pattern (Mobile)

### Description

Les hooks personnalisés encapsulent la logique métier réutilisable et permettent de la partager entre composants.

### Implémentation dans FFD Connect

```typescript
// Hook pour la logique de compétitions
export const useCompetitionsLogic = () => {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchCompetitions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await competitionsService.getAll();
      setCompetitions(data);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompetitions();
  }, []);

  return { competitions, loading, error, fetchCompetitions };
};
```

**Hooks disponibles:**

- `useCompetitionsLogic`: Logique des compétitions
- `useLicenseLogic`: Logique des licences
- `useScannerLogic`: Logique du scanner
- `useAudioPlayerLogic`: Logique du lecteur audio
- `useClubMembersLogic`: Logique des membres de club
- `useLiveTiming`: Logique du timing en direct

## Exception Filter Pattern (Backend)

### Description

Les Exception Filters interceptent les exceptions levées dans l'application et retournent des réponses standardisées.

### Implémentation dans FFD Connect

```typescript
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException ? exception.getResponse() : 'Internal server error';

    // Logging structuré
    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url} - ${message}`);
    } else if (status >= 400) {
      this.logger.warn(`${request.method} ${request.url} - ${message}`);
    }

    // Réponse standardisée
    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message,
    });
  }
}
```

**Avantages:**

- ✅ Format de réponse cohérent
- ✅ Logging centralisé
- ✅ Gestion d'erreurs standardisée
- ✅ Facilite le debugging

## Interceptor Pattern (Backend)

### Description

Les Interceptors interceptent les requêtes et réponses pour ajouter des fonctionnalités transversales (logging, transformation, etc.).

### Implémentation dans FFD Connect

```typescript
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url } = request;
    const now = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse<Response>();
          const delay = Date.now() - now;
          this.logger.log(`${method} ${url} ${response.statusCode} - ${delay}ms`);
        },
        error: (error) => {
          const delay = Date.now() - now;
          this.logger.error(`${method} ${url} - ${delay}ms - ${error.message}`);
        },
      }),
    );
  }
}
```

**Avantages:**

- ✅ Logging automatique des requêtes
- ✅ Mesure des temps d'exécution
- ✅ Traçage des erreurs
- ✅ Fonctionnalité transversale sans modifier le code métier

## Guard Pattern (Backend)

### Description

Les Guards déterminent si une requête doit être traitée par le route handler.

### Implémentation dans FFD Connect

```typescript
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any) {
    if (err || !user) {
      throw new UnauthorizedException('Invalid token');
    }
    return user;
  }
}
```

**Utilisation:**

```typescript
@Controller('competitions')
@UseGuards(JwtAuthGuard)
export class CompetitionsController {
  // Routes protégées
}
```

**Avantages:**

- ✅ Protection des routes
- ✅ Authentification centralisée
- ✅ Réutilisable
- ✅ Facile à tester

## Accès aux données (Prisma + cache Redis)

Le backend utilise Prisma (PostgreSQL) comme ORM. Conventions :

- Privilégier `select` sur `include`, et n'exposer que les champs nécessaires.
- Ajouter `take` aux requêtes non bornées ; indexer les colonnes fréquemment requêtées.
- Réutiliser les sélections partagées de `src/utils/prisma-selects.ts` plutôt que d'inliner des objets `select`.

Redis sert de cache applicatif (vérifier le cache avant la DB, puis réécrire avec un TTL).

## Stockage de fichiers (Azure Blob Storage)

`BlobStorageService` (`apps/backend/src/storage/`) encapsule le stockage d'objets sur **Azure Blob Storage** (`@azure/storage-blob`).

- Deux modes d'authentification : chaîne de connexion (`AZURE_STORAGE_CONNECTION_STRING`) ou **identité managée** (`DefaultAzureCredential`) en production sur Azure.
- Conteneurs séparés selon l'usage (`tracks`, `uploads` pour les certificats de licence/médicaux).
- **Dégradation gracieuse** : si aucune configuration n'est présente, le service se désactive (`isEnabled() === false`) et retombe sur le disque local. Le pattern d'upload est **sans état** — le service ne conserve pas de contexte entre deux appels.

## Synchronisation offline-first (client)

Le client applique une stratégie **offline-first** pour les mutations critiques via `useOfflineQueue` (`apps/client/src/hooks/`) :

- Les mutations sont **mises en file d'attente** dans `AsyncStorage` quand le réseau est indisponible.
- `NetInfo` détecte le retour de connectivité et **rejoue** la file, puis invalide les clés React Query concernées.
- Le cache serveur est géré par **React Query** ; l'état applicatif par des **stores Zustand** (voir plus bas).

## Sécurité

- **Authentification JWT** : access tokens + refresh tokens avec rotation ; tokens hachés en SHA-256 en base.
- **Autorisation** : guards (`JwtAuthGuard`, `RolesGuard`) + rôles ; vérification des permissions dans les services.
- **Validation** : `class-validator` sur les DTOs, `ValidationPipe` global.
- **Protection** : Helmet, rate limiting, CORS restrictif (obligatoire en production).

## Logging et monitoring

- **Logging structuré (Pino)** : logs JSON, `pino-pretty` en développement.
- **Slow query logging Prisma** via `$extends` (actif en développement), voir `prisma.service.ts`.
- **Monitoring : Sentry uniquement** — tracking d'erreurs et release health côté backend et client. (New Relic a été retiré.)
- **Health checks** via le HealthModule.

## Tests

- Tests co-localisés (`*.spec.ts` / `*.test.ts`) à côté du code.
- Patterns Mock (services Prisma/Redis mockés) et Arrange-Act-Assert.
- Seuils de couverture par module (auth 94 %, global 65 %) vérifiés en CI ; mutation testing (Stryker) sur les modules critiques.

## Gestion d'état côté client

- **Zustand** pour l'état applicatif (player, club, competition, performance).
- **React Query** pour le cache des données serveur.
- **React Context** réservé à l'auth et au thème (ne pas ajouter de nouveau Context pour de l'état — utiliser Zustand).

---

**Dernière mise à jour:** juillet 2026 (fusion de l'ancien `docs/ARCHITECTURE_PATTERNS.md`)
