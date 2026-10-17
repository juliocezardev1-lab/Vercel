const db = require('./database');
const auth = require('./auth');

async function main() {
    const identifier = auth.normalizeIdentifier(process.env.ADMIN_IDENTIFIER);
    const password = process.env.ADMIN_PASSWORD;

    if (!auth.isValidIdentifier(identifier) || !auth.isValidPassword(password)) {
        const error = new Error('Configure ADMIN_IDENTIFIER e uma ADMIN_PASSWORD válida (12-72 UTF-8 bytes).');
        error.code = 'ADMIN_CONFIGURATION_INVALID';
        throw error;
    }

    const passwordHash = await auth.hashPassword(password);
    const result = await db.query(
        `INSERT INTO public.auth_users (identifier, password_hash, role)
         VALUES ($1, $2, 'admin')
         ON CONFLICT (identifier) DO NOTHING
         RETURNING id`,
        [identifier, passwordHash]
    );

    if (result.rowCount !== 1) {
        const error = new Error('A conta já existe; este comando não altera contas existentes.');
        error.code = 'ADMIN_ALREADY_EXISTS';
        throw error;
    }

    console.log('Conta administrativa criada. Nenhuma credencial foi exibida.');
}

main()
    .catch((error) => {
        if (['ADMIN_CONFIGURATION_INVALID', 'ADMIN_ALREADY_EXISTS'].includes(error.code)) {
            console.error('Não foi possível criar a conta administrativa:', error.message);
        } else {
            console.error('Não foi possível criar a conta administrativa:', error.code || 'DATABASE_ERROR');
        }
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.encerrar();
    });
