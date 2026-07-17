import { db, normalizeMigrationNames } from '../../config/db.js';

await normalizeMigrationNames(db);
const [batch, files] = await db.migrate.rollback();
console.log(`Rollback batch ${batch}: ${files.length} file`);
await db.destroy();
