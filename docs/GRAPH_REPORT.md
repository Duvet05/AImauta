# Graph Report - .  (2026-07-25)

## Corpus Check
- 145 files · ~123,230 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1260 nodes · 2498 edges · 95 communities (81 shown, 14 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 103 edges (avg confidence: 0.78)
- Token cost: 358,424 input · 0 output

## Community Hubs (Navigation)
- Learning Page & Curriculum
- Exercise Release Promotion
- Admin CRUD API Routes
- Gemma Exercise Detection
- 3D Tutor Avatar
- Learning Session State
- Catalog Schema Types
- PDF Delivery & File Integrity
- Exercise Candidate Matching
- TypeScript Build Config
- Tutor Pedagogy & Ollama
- PDF Page Renderer
- Runtime Dependencies
- Catalog Curriculum Validation
- Exercise Manifest Schema
- Python Tutor HTTP Client
- Exercise API & Store
- PDF Viewer Component
- NPM Script Commands
- Learning Workspace UI
- LiveKit Token & Health
- Session Route Rate Limiting
- Voice Room Metadata
- Dev Dependencies
- Manifest Schema Validators
- Private Solution Store
- Ingestion Test Fixtures
- Voice Agent Entrypoint
- Catalog Entry Validation
- Catalog Publication Lifecycle
- LiveKit Server Tests
- Catalog Library UI
- MINEDU Content Sync
- Voice Agent Tests
- Web Deployment Topology
- Exercise Ingestion Pipeline
- Release Validation Script
- Internal Turn Auth Route
- Tutor Route Errors
- Exercise Overlay Layer
- Socratic Tutor Architecture
- LiveKit Hosting & Avatar Assets
- Manifest Test Fixtures
- Exercise Route Tests
- Voice Agent Class
- Voice Worker Privacy Rules
- Package Metadata
- Amauta Icon Mark
- Client Catalog Leak Audit
- Deployment Secrets & CI
- Catalog Config & Gemma Provider
- Editorial Woodcut Artwork
- Monochrome Amauta Mark
- Pointing Character Asset
- Voice Config Tests
- Catalog Home Page
- Stage Progress UI
- Ollama Tunnel & Tutor Service
- Postgres Database Infra
- Ingest Runtime Layout
- Duotone Amauta Mark
- Celebrating Character Asset
- Hint Character Asset
- Voice Agent Settings
- LiveKit Compose Stack
- Apple Touch Icon
- Amauta Pattern Tile
- Thinking Character Asset
- Paper Texture Asset
- HMAC Session Signing
- MINEDU Curriculum Sources
- Review Gate & SSH Tunnels
- LiveKit Config Rendering
- Sensitive Log Redaction
- Amauta Divider Asset
- PDF Materials Endpoint
- Runtime Init Script
- Private Ingestion Boundary
- LiveKit Env Init Script
- Web Env Init Script
- Next.js Root Layout
- LiveKit Network Firewall
- AImauta Visual System
- Math Fiches License Conflict
- Voice Agent CI Build
- ESLint Next Config
- Ingestion Error Type
- Next.js Config
- Three.js Type Definitions
- TypeScript Package
- Voice Worker Package Init
- Voice Agent Package Name

## God Nodes (most connected - your core abstractions)
1. `errorResponse()` - 37 edges
2. `getBook()` - 34 edges
3. `jsonResponse()` - 29 edges
4. `getPageActivity()` - 25 edges
5. `promoteExerciseRelease()` - 22 edges
6. `readJsonBody()` - 21 edges
7. `guideLearningTurn()` - 21 edges
8. `scripts` - 20 edges
9. `ingestExercisesFromPdf()` - 17 edges
10. `validateCatalogEntrySchema()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `RAG por página con exclusión de Evaluamos` --semantically_similar_to--> `Recuperación léxica acotada a libro, ficha y ventana de páginas`  [INFERRED] [semantically similar]
  README.md → docs/ARCHITECTURE.md
- `Reglas de uso de marca y personaje` --semantically_similar_to--> `Avatar 3D local y privado (MakeHuman CC0 + Three.js)`  [INFERRED] [semantically similar]
  docs/BRAND_ASSETS.md → README.md
- `CI job validate (GitHub Actions)` --semantically_similar_to--> `Regla de ejecución exclusiva en PowerEdge`  [INFERRED] [semantically similar]
  .github/workflows/ci.yml → README.md
- `CI step: npm run catalog:validate` --references--> `lib/catalog.ts (catálogo v2)`  [INFERRED]
  .github/workflows/ci.yml → docs/ARCHITECTURE.md
- `SHA-256 asset integrity record` --semantically_similar_to--> `Image pinning by version plus digest`  [INFERRED] [semantically similar]
  public/avatars/README.md → infra/db/README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Flujo de un turno socrático compartido por texto y voz** — docs_architecture_api_tutor, docs_architecture_api_internal_turn, docs_architecture_guidelearningturn, docs_architecture_recuperacion_lexica, docs_architecture_movimientos_pedagogicos, readme_ollama_gemma [EXTRACTED 1.00]
- **Puerta fail-closed de publicación de materiales** — docs_content_policy_puerta_publicacion, docs_architecture_ciclo_vida_catalogo, docs_architecture_lib_catalog, docs_architecture_lib_curriculum, docs_deployment_sincronizacion_indexacion, github_workflows_ci_catalog_validate [INFERRED 0.85]
- **Activación fail-closed del canal de voz LiveKit** — docs_architecture_api_livekit_token, docs_architecture_dispatch_aimauta_socratic_tutor, docs_architecture_topicos_datos_livekit, readme_worker_voz_livekit, readme_avatar_local, docs_deployment_hardening_contenedor_worker [EXTRACTED 1.00]
- **Book ingestion, review and promotion flow** — infra_ingest_readme_exercises_ingest, infra_ingest_readme_manual_review, infra_ingest_readme_exercises_validate, infra_ingest_readme_exercises_promote, infra_ingest_readme_public_exercise_manifest, infra_ingest_readme_private_solution_manifest [EXTRACTED 1.00]
- **Loopback-only service topology fronted by a single public edge** — infra_db_compose_loopback_port_binding, infra_web_compose_app_service, infra_web_compose_edge_service, infra_web_readme_tailscale_funnel, infra_livekit_readme_network_boundary [INFERRED 0.85]
- **Reproducible pinned artifacts via version + digest/SHA-256** — infra_db_readme_digest_pinning, infra_livekit_compose_livekit_service, infra_livekit_compose_caddy_service, infra_web_compose_edge_service, public_avatars_readme_sha256_integrity [INFERRED 0.85]

## Communities (95 total, 14 thin omitted)

### Community 0 - "Learning Page & Curriculum"
Cohesion: 0.06
Nodes (66): generateMetadata(), LearningPage(), LearningPageProps, getBook(), curriculaByBook, curriculumEntries, getBookCurriculum(), getBookUnits() (+58 more)

### Community 1 - "Exercise Release Promotion"
Cohesion: 0.06
Nodes (66): getCatalogEntries(), BOOK_INDEX_VERSION, INDEX_EXTRACTOR_VERSION, acquirePromotionLock(), allowedIndexKinds, allowedIndexStages, artifactFailure(), canonicalBytes() (+58 more)

### Community 2 - "Admin CRUD API Routes"
Cohesion: 0.14
Nodes (42): DELETE(), GET(), PATCH(), RouteContext, GET(), POST(), DELETE(), GET() (+34 more)

### Community 3 - "Gemma Exercise Detection"
Cohesion: 0.08
Nodes (42): assertCanonicalBase64(), boundedString(), box2d(), boxSchema, cancelResponse(), confidence(), DetectedExercise, DetectExerciseWindowInput (+34 more)

### Community 4 - "3D Tutor Avatar"
Cohesion: 0.07
Nodes (28): ACTIVE_STATES, AvatarRuntime, createAudioAnalysisGraph(), disposeAvatar(), disposeMaterial(), disposeRenderer(), disposeRuntime(), MorphMesh (+20 more)

### Community 5 - "Learning Session State"
Cohesion: 0.12
Nodes (32): assertCurrentRevision(), attemptDigest(), canonicalAttemptText(), conceptMatches(), encode(), evolve(), hintLevelFor(), irrelevantAttemptWords (+24 more)

### Community 6 - "Catalog Schema Types"
Cohesion: 0.07
Nodes (31): CatalogEntryBase, catalogEntryFields, CatalogLanguage, catalogLanguages, CatalogManifestParseResult, CatalogProvenance, catalogProvenances, CatalogSchemaIssue (+23 more)

### Community 7 - "PDF Delivery & File Integrity"
Cohesion: 0.10
Nodes (23): GET(), handle(), HEAD(), localPdfResponse(), pdfHeaders(), remotePdfResponse(), RouteContext, FileIdentity (+15 more)

### Community 8 - "Exercise Candidate Matching"
Cohesion: 0.12
Nodes (27): Candidate, CandidateGroup, candidatesMatch(), candidateSortKey(), candidatesSemanticallyCompatible(), deduplicateRegions(), DetectExercisesCallback, ExerciseIngestionErrorCode (+19 more)

### Community 9 - "TypeScript Build Config"
Cohesion: 0.07
Nodes (27): dom, dom.iterable, esnext, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules, **/*.ts (+19 more)

### Community 10 - "Tutor Pedagogy & Ollama"
Cohesion: 0.15
Nodes (20): LearningExerciseBinding, askOllama(), OllamaChatResponse, OllamaMessage, buildTutorSystemPrompt(), fallbackGuide(), getTurnPolicy(), GuidanceMove (+12 more)

### Community 11 - "PDF Page Renderer"
Cohesion: 0.11
Nodes (19): invalidInput(), openPdfPageRenderer(), OpenPdfPageRendererInput, PDF_RENDER_VERSION, PdfDocument, PdfJsModule, PdfPageRendererError, PdfPageRendererErrorCode (+11 more)

### Community 12 - "Runtime Dependencies"
Cohesion: 0.08
Nodes (25): livekit-client, livekit-server-sdk, @napi-rs/canvas, next, dependencies, livekit-client, livekit-server-sdk, @napi-rs/canvas (+17 more)

### Community 13 - "Catalog Curriculum Validation"
Cohesion: 0.14
Nodes (20): CatalogEntry, CatalogStatus, getAdministrativeCatalogEntries(), getCatalogManifestIssues(), MaterialType, assertCatalogCurriculumIsValid(), CatalogValidationIssue, hasText() (+12 more)

### Community 14 - "Exercise Manifest Schema"
Cohesion: 0.08
Nodes (23): Exercise, ExerciseHint, exerciseKeys, ExerciseManifest, ExerciseManifestIssue, ExerciseManifestParseResult, ExerciseManifestValidationOptions, ExerciseRubricItem (+15 more)

### Community 15 - "Python Tutor HTTP Client"
Cohesion: 0.17
Nodes (13): Any, ClientSession, RuntimeError, TutorClient, TutorServiceError, TutorTurn, InvalidJsonResponse, Response (+5 more)

### Community 16 - "Exercise API & Store"
Cohesion: 0.16
Nodes (18): errorResponse(), GET(), matchesEtag(), requestedPage(), RouteContext, projectPublicExerciseManifest(), cache, CACHE_KEY (+10 more)

### Community 17 - "PDF Viewer Component"
Cohesion: 0.12
Nodes (13): destroyLoadingTask(), isDefinitivePdfError(), loadPdfJs(), PdfDocument, PdfJsModule, PdfLoadingTask, PdfPage, PdfRenderTask (+5 more)

### Community 18 - "NPM Script Commands"
Cohesion: 0.10
Nodes (20): scripts, build, catalog:validate, content:index, content:sync, db:generate, db:migrate, db:studio (+12 more)

### Community 19 - "Learning Workspace UI"
Cohesion: 0.12
Nodes (13): Citation, citationDetails(), ConversationMessage, LearningWorkspace(), LearningWorkspaceProps, MessageBubble(), PageExercisesResponse, SessionResponse (+5 more)

### Community 20 - "LiveKit Token & Health"
Cohesion: 0.18
Nodes (12): GET(), json(), POST(), getPublishedExercise(), learningSessionErrorStatus(), configuration(), createVoiceAccess(), isLoopback() (+4 more)

### Community 21 - "Session Route Rate Limiting"
Cohesion: 0.20
Nodes (12): errorResponse(), json(), POST(), resolveExerciseBinding(), SessionRequest, BUCKET_STORE_KEY, buckets, consumeRateLimit() (+4 more)

### Community 22 - "Voice Room Metadata"
Cohesion: 0.22
Nodes (14): BaseModel, DispatchMetadata, parse_dispatch_metadata(), parse_room_metadata(), RoomMetadata, test_accepts_private_dispatch_metadata_for_same_session(), test_accepts_server_metadata(), test_rejects_foreign_room_prefix() (+6 more)

### Community 23 - "Dev Dependencies"
Cohesion: 0.12
Nodes (17): eslint, devDependencies, eslint, pdf-parse, prisma, tsx, @types/node, @types/react (+9 more)

### Community 24 - "Manifest Schema Validators"
Cohesion: 0.37
Nodes (17): hasText(), isIsoDateTime(), isPositiveInteger(), isRecord(), issue(), parseJsonInput(), rejectReasoningTrace(), rejectUnknownKeys() (+9 more)

### Community 25 - "Private Solution Store"
Cohesion: 0.20
Nodes (12): PrivateExerciseSolution, copySolution(), ExerciseSolutionUnavailableError, getReviewedExerciseSolution(), readPrivateManifest(), solutionDirectory(), loadPublicExerciseManifest(), book (+4 more)

### Community 26 - "Ingestion Test Fixtures"
Cohesion: 0.20
Nodes (14): ExerciseDetectionResult, ExerciseSolution, PdfPageRenderer, activity(), catalogEntry, checksum, denseDetection(), emptyDetection() (+6 more)

### Community 27 - "Voice Agent Entrypoint"
Cohesion: 0.26
Nodes (12): JobContext, JobProcess, entrypoint(), install_context_listener(), install_privacy_log_filter(), install_session_deadline(), main(), prewarm() (+4 more)

### Community 28 - "Catalog Entry Validation"
Cohesion: 0.22
Nodes (14): entryId(), freezeCatalogEntry(), hasText(), isCatalogEntrySafe(), isCourseId(), isEducationLevelId(), isExactIsoDate(), isHttpsUrl() (+6 more)

### Community 29 - "Catalog Publication Lifecycle"
Cohesion: 0.17
Nodes (13): Ciclo de vida draft → review → published → disabled, Índice v2 con linaje y reporte de calidad, lib/catalog.ts (catálogo v2), Recuperación léxica acotada a libro, ficha y ventana de páginas, Procedencia pendiente de la ilustración fuente, Artefactos operativos fuera de Git, Atribución y trazabilidad de citas, Procedimiento de corrección o retiro (+5 more)

### Community 30 - "LiveKit Server Tests"
Cohesion: 0.15
Nodes (3): exercise, exerciseStore, sdk

### Community 31 - "Catalog Library UI"
Cohesion: 0.24
Nodes (9): BookCard(), BookCardProps, subjectSymbols, CatalogLibrary(), CatalogLibraryProps, normalize(), resultLabel(), uniqueSorted() (+1 more)

### Community 32 - "MINEDU Content Sync"
Cohesion: 0.29
Nodes (11): isAllowedOfficialSource(), assertPdf(), assertPinnedBook(), ContentManifest, ContentRecord, main(), readManifest(), selectedBooks() (+3 more)

### Community 33 - "Voice Agent Tests"
Cohesion: 0.23
Nodes (6): dispatch_metadata(), FakeHttp, FakeRoom, test_context_listener_accepts_only_exact_student_identity(), test_entrypoint_keeps_http_open_until_job_shutdown(), test_worker_health_server_is_loopback_only()

### Community 34 - "Web Deployment Topology"
Cohesion: 0.22
Nodes (11): Nginx 404 for /admin, /api/admin, /api/ingest, /api/upload, Atomic rename activation point, npm run exercises:promote, exercise-solutions/<bookId>.private.json, manifests/exercises/<bookId>.public.json, /api/health healthcheck endpoint, aimauta-web app service (Next.js on 127.0.0.1:3309), aimauta-web edge service (nginx on 127.0.0.1:3308) (+3 more)

### Community 35 - "Exercise Ingestion Pipeline"
Cohesion: 0.29
Nodes (11): buildOverlappingPageWindows(), classifyGroup(), ExerciseIngestionInput, fail(), ingestExercisesFromPdf(), isRecord(), normalizeCandidate(), normalizeDetection() (+3 more)

### Community 36 - "Release Validation Script"
Cohesion: 0.35
Nodes (10): parsePrivateExerciseSolutionsManifest(), parsePublicExerciseManifest(), projectPrivateSolutionsManifest(), validateExerciseManifests(), validateReviewedExerciseRelease(), validationFailure(), main(), parsePathOption() (+2 more)

### Community 37 - "Internal Turn Auth Route"
Cohesion: 0.33
Nodes (6): cleanText(), InternalTurnRequest, json(), POST(), InternalAuthConfigurationError, isAuthorizedAgentRequest()

### Community 38 - "Tutor Route Errors"
Cohesion: 0.27
Nodes (6): cleanText(), json(), POST(), TutorRequest, ExerciseManifestUnavailableError, LearningSessionError

### Community 39 - "Exercise Overlay Layer"
Cohesion: 0.27
Nodes (9): ExerciseOverlayLayer(), ExerciseOverlayLayerProps, ExerciseOverlayState, ExerciseSelection, isRenderableRegion(), PageExerciseRegion, percent(), regionLabel() (+1 more)

### Community 40 - "Socratic Tutor Architecture"
Cohesion: 0.20
Nodes (10): Límites de confianza (entrada no confiable, texto del PDF), Cinco movimientos pedagógicos cerrados (OBSERVA, REFORMULA, COMPARA, COMPRUEBA, DIVIDE), Topología PowerEdge / Aule / LiveKit Cloud, Política de contenidos y datos, Despliegue en PowerEdge, CI step: npm run catalog:validate, CI job validate (GitHub Actions), AImauta (plataforma de aprendizaje guiado) (+2 more)

### Community 41 - "LiveKit Hosting & Avatar Assets"
Cohesion: 0.22
Nodes (10): Image pinning by version plus digest, Ephemeral rooms without Redis (no HA/SLA), LiveKit Cloud / Inference credential gap, LiveKit self-hosting upstream docs, Self-hosted LiveKit single-node MVP, AIMAUTA_VOICE_TUTOR_ENABLED feature flag, aimauta-teacher.glb optimized avatar, gltf-transform meshopt/webp optimization (+2 more)

### Community 42 - "Manifest Test Fixtures"
Cohesion: 0.22
Nodes (4): EXERCISE_COORDINATE_SPACE, PrivateExerciseSolutionsManifest, PublicExerciseManifest, book

### Community 43 - "Exercise Route Tests"
Cohesion: 0.20
Nodes (7): PublicExercise, context, multipageExercise, reviewExercise, store, exercise, exerciseStore

### Community 44 - "Voice Agent Class"
Cohesion: 0.25
Nodes (5): Agent, ChatContext, ChatMessage, Room, AImautaVoiceAgent

### Community 45 - "Voice Worker Privacy Rules"
Cohesion: 0.25
Nodes (9): POST /api/livekit/token, Dispatch nombrado aimauta-socratic-tutor, Worker de voz sin LLM propio (llm=None, record=False), Reglas de uso de marca y personaje, Privacidad de estudiantes y minimización de datos, Hardening del contenedor del worker de voz, Alternativa LiveKit Server self-hosted (no compatible con el worker actual), Avatar 3D local y privado (MakeHuman CC0 + Three.js) (+1 more)

### Community 46 - "Package Metadata"
Cohesion: 0.22
Nodes (8): engines, node, name, overrides, postcss, sharp, private, version

### Community 47 - "Amauta Icon Mark"
Cohesion: 0.28
Nodes (9): Accessible SVG with role=img and titled label "Amauta", Stylized Andean sage face with patterned cap, Intended use as app icon / favicon / avatar mark, Flat two-tone geometric illustration style, Amauta Icon (SVG brand mark), Brand palette: deep teal #172d2a and coral #ee8068, Speech-bubble silhouette with tail, Portrait 32x36 viewBox, no fixed width/height (+1 more)

### Community 48 - "Client Catalog Leak Audit"
Cohesion: 0.22
Nodes (7): leaks, manifest, manifestPath, privateEntries, privateMarkers, projectRoot, staticDirectory

### Community 49 - "Deployment Secrets & CI"
Cohesion: 0.25
Nodes (8): POST /api/internal/turn, voice-agent.env (STT/TTS Deepgram, MAX_SESSION_SECONDS), Operación segura (checklist permanente), Perfil web: Funnel → reverse SSH → Nginx 3308 → Next.js 3309, Secretos dedicados AIMAUTA_SESSION_SECRET y AIMAUTA_AGENT_SECRET, CI step: smoke del contrato LiveKit Inference, CI step: validar compose.yaml y nginx.conf, Límites de admisión por sesión y fingerprint

### Community 50 - "Catalog Config & Gemma Provider"
Cohesion: 0.25
Nodes (8): config/catalog.v3.json, npm run catalog:validate, config/curricula.v3.json, npm run exercises:ingest coordinator, npm run exercises:validate, Gemini Developer API / Gemma 4 provider, model-api-key provider credential, No student data sent to unpaid provider

### Community 51 - "Editorial Woodcut Artwork"
Cohesion: 0.39
Nodes (8): Reference: 1920s Peruvian Amauta Magazine Indigenista Aesthetic, Amauta Editorial Artwork (Woodcut Head), Mood: Solemn, Ancestral, Dignified Indigenismo, Andean Textile Motifs: Chevrons, Zigzags, Stepped Patterns, Braided Headwear, Palette: Terracotta Red, Charcoal Black, Cream Paper Ground, Depiction: Stylized Andean Face in Profile-Frontal View, Style: Two-Color Woodcut / Linocut Print on Aged Paper, Intended Use: Editorial Brand Illustration for Amauta Identity

### Community 52 - "Monochrome Amauta Mark"
Cohesion: 0.29
Nodes (8): Accessible SVG Labeling (role=img, Spanish title/desc), Asymmetric Amauta Face Depiction, Andean Visual Identity Reference, Chullo Hat with Chevron Textile Band, Single-Ink currentColor Treatment, Amauta Monochrome Mark (SVG), Reusable Chevron Symbol Definition, Single-Color / Stamp Usage Context

### Community 53 - "Pointing Character Asset"
Cohesion: 0.36
Nodes (8): Andean Woodcut/Linocut Visual Style (Terracotta and Dark Green Duotone), amauta-points.webp (Brand Character Asset), Amauta Character Illustration, Chevron-Patterned Headdress and Zigzag-Trimmed Tunic, Neutral Calm Expression, Frontal Face with Profile Nose, Guidance / Pointing UI State (Onboarding, Hints, Directional Callouts), Pointing Pose (Right Hand, Index Finger Extended), Transparent-Background Half-Body Cutout for Overlay Placement

### Community 54 - "Voice Config Tests"
Cohesion: 0.46
Nodes (7): settings(), test_accepts_loopback_http_backend(), test_pinned_sdk_accepts_livekit_inference_contract(), test_requires_https_for_remote_backend(), test_requires_tls_for_remote_livekit(), test_uses_livekit_inference_defaults_without_deepgram_key(), test_voice_session_duration_has_safe_bounds()

### Community 55 - "Catalog Home Page"
Cohesion: 0.38
Nodes (4): CatalogPage(), BrandMark(), getBooks(), getPublishedBooks()

### Community 56 - "Stage Progress UI"
Cohesion: 0.29
Nodes (5): StageProgress(), StageProgressProps, stages, PageActivity, LearningSessionState

### Community 57 - "Ollama Tunnel & Tutor Service"
Cohesion: 0.29
Nodes (7): POST /api/tutor, guideLearningTurn (lib/tutor-service.ts), Túnel SSH 127.0.0.1:11435 → Aule 127.0.0.1:11434, web.env de Next.js (variables AIMAUTA_* y LIVEKIT_*), Unidad systemd de usuario del túnel Ollama y linger, Ollama + Gemma en loopback (Aule), tutor-service (servicio único texto y voz)

### Community 58 - "Postgres Database Infra"
Cohesion: 0.29
Nodes (7): aimauta-db-data named volume, Loopback-only port publishing (127.0.0.1), aimauta-db postgres service, DATABASE_URL root .env contract, infra/db/db.env secrets file (git-ignored), Local development Postgres for Prisma, Prisma school directory (Level -> Grade -> Course -> Student/Teacher)

### Community 59 - "Ingest Runtime Layout"
Cohesion: 0.33
Nodes (7): aimauta-ingest root (inbox/jobs/secrets), aimauta-runtime root (content/indexes/manifests/releases), infra/ingest/init-runtime.sh, /_edge-health nginx health route, Read-only runtime mounts under /srv/aimauta, Pre-promotion validation gate (catalog/typecheck/lint/test/compose config), aimauta-runtime/web.env environment file

### Community 60 - "Duotone Amauta Mark"
Cohesion: 0.38
Nodes (7): Accessible SVG Role/Title/Desc Metadata (Spanish), Asymmetric Amauta Face Motif, Intended Use as Amauta Brand Mark / App Icon, Chullo Hat with Chevron Weave Band, Amauta Duotone Mark (SVG), Duotone Palette: Deep Teal #172d2a and Coral #ee8068, Peruvian Woodcut/Engraving-Inspired Style

### Community 61 - "Celebrating Character Asset"
Cohesion: 0.33
Nodes (7): Amauta Character (Andean Teacher/Sage Mascot), Emotional State: Pride, Encouragement, Celebration, Amauta Celebrates Character Illustration (WebP), Thumbs-Up Approval Pose, Bust Framing, Smiling Expression, Flat Two-Tone Style: Deep Green + Terracotta Orange, Andean Textile Motifs, Transparent/White Background Cutout Asset for Overlay, Intended UI Use: Success / Correct-Answer / Completion State

### Community 62 - "Hint Character Asset"
Cohesion: 0.38
Nodes (7): Amauta Teacher Character (Andean Sage), Calm Neutral Expression, Direct Forward Gaze, Amauta Hint Character Illustration, Andean Textile Motifs (Chevron Cap, Zigzag Cuff, Stepped Braid), Raised Index Finger Pose (Attention / Point of Advice), Flat Two-Tone Andean Graphic Style (Terracotta Orange / Dark Green), Hint UI State Mascot

### Community 63 - "Voice Agent Settings"
Cohesion: 0.33
Nodes (3): BaseSettings, HttpUrl, Settings

### Community 64 - "LiveKit Compose Stack"
Cohesion: 0.47
Nodes (6): caddyl4 TLS/SNI terminator service, livekit server service (host network, read-only), infra/livekit/init-env.sh, Single key-pair rotation procedure, runtime/livekit.keys API key pair, infra/livekit/render-config.sh

### Community 65 - "Apple Touch Icon"
Cohesion: 0.47
Nodes (6): Andean Sage Face Mark, Amauta Apple Touch Icon, Flat Geometric Two-Tone Illustration Style, iOS Home Screen / Apple Touch Icon Usage, Salmon and Dark Green Brand Palette, Zigzag Andean Headband Motif

### Community 66 - "Amauta Pattern Tile"
Cohesion: 0.40
Nodes (6): Decorative Marking (aria-hidden, focusable=false), Andean Chevron and Stepped-Diamond Motif, Coral #ee8068 on Cream #fffdf7 Palette, Andean Textile / Chakana Visual Reference, Amauta Pattern SVG Tile (96x96), Decorative Tiling Background Usage

### Community 67 - "Thinking Character Asset"
Cohesion: 0.40
Nodes (6): Amauta Mascot: Andean Figure in Thinking Pose, Ambiguous Gender/Identity Reading of Depicted Figure, Amauta Thinks Character Illustration (WebP), Hand-to-Chin Thinking Pose with Neutral Sidelong Gaze, Flat Two-Tone Woodcut Style: Terracotta Orange on Dark Green with Andean Zigzag Motifs, Intended UI Use: Thinking / Loading / Processing State

### Community 68 - "Paper Texture Asset"
Cohesion: 0.47
Nodes (6): Amauta Brand Visual Identity System, Subtle Fiber Flecks and Grain Detail, Beige Recycled Fiber Paper Material, Warm Organic Handmade Analog Aesthetic, Paper Texture Asset (paper-texture.webp), Seamless Tiling Background Overlay Usage

### Community 69 - "HMAC Session Signing"
Cohesion: 0.40
Nodes (5): POST /api/session, Estado de sesión single-instance sin progreso durable, Tópicos de datos aimauta.context.v1 / aimauta.session.v1, Registro anti-replay efímero en memoria, Sesión anónima firmada con HMAC-SHA-256

### Community 70 - "MINEDU Curriculum Sources"
Cohesion: 0.50
Nodes (5): lib/curriculum.ts (currículo por página), Descubrimiento no es importación (librosescolaresperu.com), Repositorio Institucional del MINEDU, Fichas de Matemática 1 (MINEDU 10834), Fichas de Matemática 2 (MINEDU 10835)

### Community 71 - "Review Gate & SSH Tunnels"
Cohesion: 0.40
Nodes (5): draft -> review -> published lifecycle, Manual human review gate, SSH-tunneled review UI on 127.0.0.1:3310, Restricted reverse SSH tunnel key (PowerEdge -> Aule), Tailscale Funnel public exposure via Aule

### Community 73 - "Sensitive Log Redaction"
Cohesion: 0.40
Nodes (4): LogRecord, Remove transcript-shaped structured fields before a record is emitted., SensitiveLogFilter, test_sensitive_log_filter_redacts_structured_transcript_fields()

### Community 74 - "Amauta Divider Asset"
Cohesion: 0.50
Nodes (5): Andean Textile / Chevron Iconography, Brand Palette: Deep Teal #172d2a + Coral #ee8068, Decorative Section Break Usage (aria-hidden, full-width stretch), Amauta Divider (Decorative SVG Rule), Tiling Pattern Motif (96x48 userSpaceOnUse)

### Community 75 - "PDF Materials Endpoint"
Cohesion: 0.50
Nodes (4): GET/HEAD /api/materials/:bookId/pdf, Bloqueo assessment-locked en Evaluamos, Checklist de validación posterior al despliegue, Visor PDF.js same-origin

### Community 76 - "Runtime Init Script"
Cohesion: 0.83
Nodes (3): ensure_directory(), normalize_runtime_file(), init-runtime.sh script

### Community 77 - "Private Ingestion Boundary"
Cohesion: 0.50
Nodes (4): Isolated single-use job execution, Private book ingestion pipeline, SSH-only authentication boundary (no admin HTTP endpoint), Hardened container profile (non-root, read_only, cap_drop ALL, no-new-privileges)

### Community 81 - "LiveKit Network Firewall"
Cohesion: 0.67
Nodes (3): Intentional host networking for WebRTC/TURN, LiveKit network boundary (443/7881/3478/7882 public, 7880/5349 loopback), aimauta-livekit.nft firewall guard table

## Ambiguous Edges - Review These
- `aimauta-ingest root (inbox/jobs/secrets)` → `aimauta-runtime/web.env environment file`  [AMBIGUOUS]
  infra/ingest/README.md · relation: references
- `Tiling Pattern Motif (96x48 userSpaceOnUse)` → `Andean Textile / Chevron Iconography`  [AMBIGUOUS]
  public/brand/amauta-divider.svg · relation: conceptually_related_to
- `Depiction: Stylized Andean Face in Profile-Frontal View` → `Reference: 1920s Peruvian Amauta Magazine Indigenista Aesthetic`  [AMBIGUOUS]
  public/brand/amauta-editorial.webp · relation: conceptually_related_to
- `Amauta Icon (SVG brand mark)` → `Stylized Andean sage face with patterned cap`  [AMBIGUOUS]
  public/brand/amauta-icon.svg · relation: references
- `Andean Chevron and Stepped-Diamond Motif` → `Andean Textile / Chakana Visual Reference`  [AMBIGUOUS]
  public/brand/amauta-pattern.svg · relation: references
- `Amauta Mascot: Andean Figure in Thinking Pose` → `Ambiguous Gender/Identity Reading of Depicted Figure`  [AMBIGUOUS]
  public/brand/characters/amauta-thinks.webp · relation: conceptually_related_to

## Knowledge Gaps
- **329 isolated node(s):** `RouteContext`, `RouteContext`, `InternalTurnRequest`, `RouteContext`, `RouteContext` (+324 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `aimauta-ingest root (inbox/jobs/secrets)` and `aimauta-runtime/web.env environment file`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Tiling Pattern Motif (96x48 userSpaceOnUse)` and `Andean Textile / Chevron Iconography`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Depiction: Stylized Andean Face in Profile-Frontal View` and `Reference: 1920s Peruvian Amauta Magazine Indigenista Aesthetic`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Amauta Icon (SVG brand mark)` and `Stylized Andean sage face with patterned cap`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Andean Chevron and Stepped-Diamond Motif` and `Andean Textile / Chakana Visual Reference`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Amauta Mascot: Andean Figure in Thinking Pose` and `Ambiguous Gender/Identity Reading of Depicted Figure`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Response` connect `Python Tutor HTTP Client` to `LiveKit Token & Health`?**
  _High betweenness centrality (0.100) - this node is a cross-community bridge._