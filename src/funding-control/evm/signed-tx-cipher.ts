import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Hex } from 'viem';

export interface SignedTransactionCipher {
  encrypt(raw:Hex):{ciphertext:string;iv:string;authTag:string};
  decrypt(value:{ciphertext:string;iv:string;authTag:string}):Hex;
}

/** Inject a 32-byte key from a secret manager. Never persist or log the key. */
export class AesGcmSignedTransactionCipher implements SignedTransactionCipher {
  constructor(private readonly key:Buffer){if(key.length!==32)throw new Error('Signed transaction encryption key must be 32 bytes');}
  encrypt(raw:Hex){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',this.key,iv);const ciphertext=Buffer.concat([cipher.update(raw,'utf8'),cipher.final()]);return{ciphertext:ciphertext.toString('base64'),iv:iv.toString('base64'),authTag:cipher.getAuthTag().toString('base64')};}
  decrypt(value:{ciphertext:string;iv:string;authTag:string}):Hex{const decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(value.iv,'base64'));decipher.setAuthTag(Buffer.from(value.authTag,'base64'));return Buffer.concat([decipher.update(Buffer.from(value.ciphertext,'base64')),decipher.final()]).toString('utf8') as Hex;}
}
