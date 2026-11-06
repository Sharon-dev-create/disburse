import 'dotenv/config';
import { z } from 'zod';
const schema=z.object({DATABASE_URL:z.string().url(),NEAR_INTENTS_BASE_URL:z.string().url().default('https://1click.chaindefuser.com'),NEAR_INTENTS_JWT:z.string().optional()});
export const env=schema.parse(process.env);
