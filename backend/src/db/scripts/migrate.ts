import { db, normalizeMigrationNames } from '../../config/db.js';

await normalizeMigrationNames(db);
const [batch, files] = await db.migrate.latest();
if (files.length === 0) console.log('Migrasi: sudah paling baru.');
else console.log(`Migrasi batch ${batch}:\n- ${files.join('\n- ')}`);
await db.destroy();
