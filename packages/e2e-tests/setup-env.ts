import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });
console.log('NETWORK', process.env['NETWORK']);
console.log('DEPLOYMENT', process.env['DEPLOYMENT']);
