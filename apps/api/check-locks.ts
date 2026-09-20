import { prisma } from './src/lib/prisma.js';
async function run() {
  const result = await prisma.$queryRawUnsafe("SELECT pid, state, query FROM pg_stat_activity WHERE state LIKE '%transaction%' OR state = 'active'");
  console.log(result);
}
run().catch(console.error);
