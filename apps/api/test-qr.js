require('dotenv').config();
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect().then(() => {
  return client.query('SELECT b.id, t."scheduledStartAt", t."scheduledEndAt", t.status FROM "Booking" b JOIN "Trip" t ON b."tripId" = t.id ORDER BY b."createdAt" DESC LIMIT 1');
}).then(res => {
  console.log(res.rows[0]);
  client.end();
}).catch(console.error);
