import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { logger } from './config/logger.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler, notFound } from './middleware/error.js';
import { buildSessionMiddleware } from './middleware/session.js';
import { buildHealthRouter } from './features/health/health.controller.js';
import { buildMetricsRouter, metricsMiddleware } from './features/metrics/metrics.controller.js';
import { buildAuthRouter } from './features/auth/auth.controller.js';
import { buildTemporadasRouter } from './features/maestros/temporadas/temporadas.controller.js';
import { buildPlantasRouter } from './features/maestros/plantas/plantas.controller.js';
import { buildUnidadesRouter } from './features/maestros/unidades/unidades.controller.js';
import { buildGruposProductorRouter } from './features/maestros/grupos-productor/grupos-productor.controller.js';
import { buildCatalogoSimpleRouter } from './features/maestros/catalogos/catalogo-simple.factory.js';
import { buildSapSyncRouter } from './features/sap-sync/sap-sync.controller.js';
import { buildAgronomosRouter, buildMiPerfilRouter } from './features/agronomos/agronomos.controller.js';
import { buildCalendarioGeneralRouter } from './features/calendario-general/calendario-general.controller.js';
import { buildEstimacionesGeneralesRouter } from './features/estimaciones-generales/estimacion.controller.js';
import {
  buildSapEspecieRouter,
  buildSapGrupoVariedadRouter,
  buildSapVariedadRouter,
  buildSapProductorRouter,
  buildSapEnvaseRouter,
  buildSapManejoRouter,
  buildSapCentroRouter,
  buildSapTipoFrioRouter,
  buildSapProgramaRouter,
} from './features/sap/sap-read.controller.js';
import { buildSapProductorVariedadRouter } from './features/sap/sap-productor-variedad.controller.js';

export function buildApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      contentSecurityPolicy: false,
    })
  );

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      customProps: (req) => ({ requestId: (req as express.Request).requestId }),
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    })
  );

  app.use(metricsMiddleware);

  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use(buildSessionMiddleware());

  // Endpoints publicos (health + metrics + auth)
  app.use(buildHealthRouter());
  app.use(buildMetricsRouter());
  app.use('/api/v1/auth', buildAuthRouter());

  // Fase 2 — Maestros internos (requieren sesion; los mutating ademas requieren CSRF + rol admin)
  app.use('/api/v1/temporadas', buildTemporadasRouter());
  app.use('/api/v1/plantas', buildPlantasRouter());
  app.use('/api/v1/unidades', buildUnidadesRouter());
  app.use('/api/v1/grupos-productor', buildGruposProductorRouter());

  // Catalogos tipo (Id, Codigo, Nombre, Orden, Activo)
  app.use('/api/v1/catalogos/condicion',    buildCatalogoSimpleRouter({ table: 'est.Condicion' }));
  app.use('/api/v1/catalogos/destino',      buildCatalogoSimpleRouter({ table: 'est.Destino' }));
  app.use('/api/v1/catalogos/tipo-calidad', buildCatalogoSimpleRouter({ table: 'est.TipoCalidad' }));
  app.use('/api/v1/catalogos/tipo-color',   buildCatalogoSimpleRouter({ table: 'est.TipoColor' }));
  app.use('/api/v1/catalogos/tipo-envase',  buildCatalogoSimpleRouter({ table: 'est.TipoEnvase' }));

  // Fase 3 — Sync SAP y lectura de tablas espejo sap.*
  app.use('/api/v1/sap-sync', buildSapSyncRouter());

  // Fase 4 — Agronomos + asignaciones
  app.use('/api/v1/agronomos', buildAgronomosRouter());
  app.use('/api/v1/mi-perfil', buildMiPerfilRouter());

  // Fase 5 — Calendario de estimacion general
  app.use('/api/v1/calendario-general', buildCalendarioGeneralRouter());

  // Fase 6 — Estimacion General con control de version
  app.use('/api/v1/estimaciones-generales', buildEstimacionesGeneralesRouter());
  app.use('/api/v1/sap/especies',         buildSapEspecieRouter());
  app.use('/api/v1/sap/grupos-variedad',  buildSapGrupoVariedadRouter());
  app.use('/api/v1/sap/variedades',       buildSapVariedadRouter());
  app.use('/api/v1/sap/productores',      buildSapProductorRouter());
  app.use('/api/v1/sap/envases',          buildSapEnvaseRouter());
  app.use('/api/v1/sap/manejos',          buildSapManejoRouter());
  app.use('/api/v1/sap/centros',          buildSapCentroRouter());
  app.use('/api/v1/sap/tipos-frio',       buildSapTipoFrioRouter());
  app.use('/api/v1/sap/programas',        buildSapProgramaRouter());
  app.use('/api/v1/sap/productor-variedades', buildSapProductorVariedadRouter());

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
