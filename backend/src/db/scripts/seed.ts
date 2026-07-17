import { db } from '../../config/db.js';

await db.seed.run();
console.log('Seed selesai.');
await db.destroy();
