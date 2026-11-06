import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createApiServer } from './server.js';

const db=new PrismaClient();const server=createApiServer(db);const port=Number(process.env.API_PORT??'8787');
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('API_PORT must be a valid TCP port');
server.listen(port,'127.0.0.1',()=>console.log(`Disburse local API listening on 127.0.0.1:${port}`));
const stop=()=>server.close(()=>{void db.$disconnect().finally(()=>process.exit(0));});
process.once('SIGINT',stop);process.once('SIGTERM',stop);
