import { getPool, mssql } from '../../infra/db.js';

export interface UsuarioUpsertInput {
  sub: string;
  usuario: string;
  nombre: string;
  email: string | null;
  primaryRole: string;
}

export interface UsuarioRow {
  UsuarioId: number;
  Sub: string;
  Usuario: string;
  Nombre: string;
  Email: string | null;
  PrimaryRole: string;
  Activo: boolean;
}

/**
 * MERGE por Sub siguiendo AUTH_STANDARD §8.bis.
 * Keycloak es fuente de verdad: cada login sobreescribe Usuario/Nombre/Email/PrimaryRole.
 */
export async function upsertUsuario(input: UsuarioUpsertInput): Promise<UsuarioRow> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('Sub', mssql.NVarChar(64), input.sub)
    .input('Usuario', mssql.NVarChar(128), input.usuario)
    .input('Nombre', mssql.NVarChar(200), input.nombre)
    .input('Email', mssql.NVarChar(256), input.email)
    .input('PrimaryRole', mssql.NVarChar(32), input.primaryRole).query(`
      MERGE est.Usuario AS t
      USING (SELECT @Sub AS Sub, @Usuario AS Usuario, @Nombre AS Nombre, @Email AS Email, @PrimaryRole AS PrimaryRole) AS s
      ON t.Sub = s.Sub
      WHEN MATCHED THEN UPDATE SET
        Usuario     = s.Usuario,
        Nombre      = s.Nombre,
        Email       = s.Email,
        PrimaryRole = s.PrimaryRole,
        UltimoLogin = SYSUTCDATETIME(),
        UpdatedAt   = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (Sub, Usuario, Nombre, Email, PrimaryRole, Activo, UltimoLogin)
        VALUES (s.Sub, s.Usuario, s.Nombre, s.Email, s.PrimaryRole, 1, SYSUTCDATETIME())
      OUTPUT inserted.UsuarioId, inserted.Sub, inserted.Usuario, inserted.Nombre,
             inserted.Email, inserted.PrimaryRole, inserted.Activo;
    `);

  const row = result.recordset[0] as UsuarioRow;
  return row;
}
